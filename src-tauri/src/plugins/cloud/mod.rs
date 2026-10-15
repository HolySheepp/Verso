// 雲端模式：用公司 Google 帳號登入，讀寫 Google Sheets。
// 登入走 Google 給桌面軟體的正式流程（瀏覽器同意後回到這台電腦的一個臨時位址）；
// 登入狀態（refresh token）只存在這台電腦的 Verso 資料夾。畫面那邊只拿得到讀寫結果，拿不到密碼。

use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const SCOPE: &str = "openid email https://www.googleapis.com/auth/spreadsheets";
/// 只轉送到 Google Sheets，不會被拿去連別的地方
const API: &str = "https://sheets.googleapis.com/v4/spreadsheets/";

#[derive(Default)]
pub struct Cloud {
    /// 目前的 access token 和到期時間
    access: Mutex<Option<(String, Instant)>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Saved {
    client_id: String,
    client_secret: String,
    refresh: String,
    email: String,
}

fn rand_hex(n: usize) -> String {
    let mut s = String::new();
    let mut i = 0u64;
    while s.len() < n {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        s.push_str(&format!("{:016x}", h.finish()));
        i += 1;
    }
    s.truncate(n);
    s
}

fn b64url(b: &[u8]) -> String { base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b) }

fn token_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("cloud");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("login.json"))
}

fn read_saved(app: &AppHandle) -> Option<Saved> {
    let t = std::fs::read_to_string(token_file(app).ok()?).ok()?;
    serde_json::from_str(&t).ok()
}

fn client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())
}

/// Google 回的錯誤整理成一句（畫面那邊再翻成看得懂的話）
async fn google_error(r: reqwest::Response) -> String {
    let status = r.status().as_u16();
    let body = r.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<Value>(&body).ok()
        .and_then(|v| v.pointer("/error/message").or(v.get("error_description")).or(v.get("error")).and_then(|m| m.as_str()).map(|s| s.to_string()))
        .unwrap_or(body.chars().take(200).collect());
    format!("{}: {}", status, msg)
}

/// email 寫在 id_token 中間那段
fn email_of(id_token: &str) -> String {
    id_token.split('.').nth(1)
        .and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p.trim_end_matches('=')).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("email").and_then(|e| e.as_str()).map(|s| s.to_string()))
        .unwrap_or_default()
}

/// 等瀏覽器回到 http://127.0.0.1:port/?code=…&state=…（最多等 5 分鐘）
fn wait_code(listener: TcpListener, state: String) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let end = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() > end { return Err("timeout".into()); }
        let (stream, _) = match listener.accept() {
            Ok(x) => x,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => { std::thread::sleep(Duration::from_millis(200)); continue; }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() { continue; }
        let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
        let Ok(u) = url::Url::parse(&format!("http://127.0.0.1{}", path)) else { continue };
        let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
        // 瀏覽器另外要的東西（例如 favicon）：不理
        if !q.contains_key("code") && !q.contains_key("error") { let _ = (&stream).write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); continue; }
        let ok = q.get("state") == Some(&state) && q.contains_key("code");
        let page = if ok { "<meta charset=utf-8><body style='font-family:sans-serif;padding:40px'>登入完成，可以回到 Verso 了。Signed in. You can return to Verso.</body>" } else { "<meta charset=utf-8><body style='font-family:sans-serif;padding:40px'>登入沒有完成，請回到 Verso 再試一次。Sign-in was not completed.</body>" };
        let _ = (&stream).write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", page.len(), page).as_bytes());
        if !ok { return Err(q.get("error").cloned().unwrap_or_else(|| "denied".into())); }
        return Ok(q["code"].clone());
    }
}

/// 登入：開瀏覽器讓使用者同意，回來後換成 token 存起來；回傳登入的 email
#[tauri::command]
pub async fn cloud_login(app: AppHandle, state: State<'_, Cloud>, client_id: String, client_secret: String) -> Result<String, String> {
    let (client_id, client_secret) = (client_id.trim().to_string(), client_secret.trim().to_string());
    if client_id.is_empty() { return Err("no-client".into()); }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let verifier = rand_hex(64);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let st = rand_hex(32);
    let mut auth = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &st)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    app.opener().open_url(auth.as_str(), None::<&str>).map_err(|e| e.to_string())?;
    let code = tauri::async_runtime::spawn_blocking(move || wait_code(listener, st)).await.map_err(|e| e.to_string())??;
    let r = client()?.post("https://oauth2.googleapis.com/token")
        .form(&[("code", code.as_str()), ("client_id", &client_id), ("client_secret", &client_secret), ("redirect_uri", &redirect), ("grant_type", "authorization_code"), ("code_verifier", &verifier)])
        .send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() { return Err(google_error(r).await); }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let access = v["access_token"].as_str().unwrap_or_default().to_string();
    let refresh = v["refresh_token"].as_str().unwrap_or_default().to_string();
    let email = email_of(v["id_token"].as_str().unwrap_or_default());
    let secs = v["expires_in"].as_u64().unwrap_or(3600);
    *state.access.lock().unwrap() = Some((access, Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    let saved = Saved { client_id, client_secret, refresh, email: email.clone() };
    std::fs::write(token_file(&app)?, serde_json::to_string(&saved).unwrap()).map_err(|e| e.to_string())?;
    Ok(email)
}

/// 目前登入的 email（沒登入是 null）
#[tauri::command]
pub fn cloud_status(app: AppHandle) -> Option<String> {
    read_saved(&app).filter(|s| !s.refresh.is_empty()).map(|s| s.email)
}

/// 登出：刪掉這台電腦上的登入資料
#[tauri::command]
pub fn cloud_logout(app: AppHandle, state: State<'_, Cloud>) {
    *state.access.lock().unwrap() = None;
    if let Ok(p) = token_file(&app) { let _ = std::fs::remove_file(p); }
}

async fn access_token(app: &AppHandle, state: &State<'_, Cloud>) -> Result<String, String> {
    if let Some((t, until)) = state.access.lock().unwrap().clone() {
        if Instant::now() < until { return Ok(t); }
    }
    let saved = read_saved(app).filter(|s| !s.refresh.is_empty()).ok_or("not-signed-in")?;
    let r = client()?.post("https://oauth2.googleapis.com/token")
        .form(&[("client_id", saved.client_id.as_str()), ("client_secret", &saved.client_secret), ("refresh_token", &saved.refresh), ("grant_type", "refresh_token")])
        .send().await.map_err(|e| e.to_string())?;
    // 登入失效（例如在 Google 帳號裡撤銷了）：當成沒登入
    if r.status().as_u16() == 400 || r.status().as_u16() == 401 { return Err("not-signed-in".into()); }
    if !r.status().is_success() { return Err(google_error(r).await); }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let t = v["access_token"].as_str().unwrap_or_default().to_string();
    let secs = v["expires_in"].as_u64().unwrap_or(3600);
    *state.access.lock().unwrap() = Some((t.clone(), Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    Ok(t)
}

/// 呼叫 Google Sheets：path 接在 https://sheets.googleapis.com/v4/spreadsheets/ 後面
#[tauri::command]
pub async fn cloud_api(app: AppHandle, state: State<'_, Cloud>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    if path.contains("..") || path.starts_with('/') || path.contains("://") { return Err("bad path".into()); }
    let token = access_token(&app, &state).await?;
    let url = format!("{}{}", API, path);
    let c = client()?;
    let req = match method.as_str() {
        "GET" => c.get(&url),
        "POST" => c.post(&url).json(&body.unwrap_or(json!({}))),
        "PUT" => c.put(&url).json(&body.unwrap_or(json!({}))),
        _ => return Err("bad method".into()),
    };
    let r = req.bearer_auth(token).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() { return Err(google_error(r).await); }
    r.json().await.map_err(|e| e.to_string())
}
