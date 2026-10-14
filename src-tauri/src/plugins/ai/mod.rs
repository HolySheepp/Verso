// AI 協助：Verso 在本機開一個小小的 MCP 服務（只有這台電腦連得到、要密碼），
// 按鈕在背景執行 Claude Code，Claude 透過這個服務讀寫條目。
// 工具清單和每次呼叫的處理都交給畫面那邊（條目資料在畫面裡），這裡只負責轉送。

use serde_json::{json, Value};
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Ai {
    server: Mutex<Option<(u16, String)>>,
    tools: Arc<Mutex<Value>>,
    pending: Arc<Mutex<HashMap<u64, Sender<(Value, bool)>>>>,
    next: Arc<AtomicU64>,
    child: Arc<Mutex<Option<Child>>>,
}

/// 隨機密碼（每次開 Verso 都不一樣）
fn token() -> String {
    let mut s = String::new();
    for i in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

/// 讀一個 HTTP 請求：回傳（方法、路徑、標頭、內容）
fn read_request(stream: &TcpStream) -> Option<(String, String, HashMap<String, String>, Vec<u8>)> {
    let mut r = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).ok()? == 0 { break; }
        let h = h.trim_end();
        if h.is_empty() { break; }
        if let Some((k, v)) = h.split_once(':') { headers.insert(k.trim().to_lowercase(), v.trim().to_string()); }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    // 太大的請求不收
    if len > 8 * 1024 * 1024 { return None; }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).ok()?;
    Some((method, path, headers, body))
}

fn respond(mut stream: &TcpStream, status: &str, body: Option<&Value>) {
    let text = body.map(|b| b.to_string()).unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        text.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(text.as_bytes());
    let _ = stream.flush();
}

fn handle(stream: TcpStream, app: AppHandle, key: String, tools: Arc<Mutex<Value>>, pending: Arc<Mutex<HashMap<u64, Sender<(Value, bool)>>>>, next: Arc<AtomicU64>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let Some((method, path, headers, body)) = read_request(&stream) else { return };
    // 只收這台電腦、帶對密碼的請求
    if headers.get("authorization").map(|v| v.as_str()) != Some(&format!("Bearer {}", key)) {
        respond(&stream, "401 Unauthorized", None);
        return;
    }
    if method != "POST" || !path.starts_with("/mcp") {
        respond(&stream, "405 Method Not Allowed", None);
        return;
    }
    let Ok(req) = serde_json::from_slice::<Value>(&body) else {
        respond(&stream, "400 Bad Request", None);
        return;
    };
    let id = req.get("id").cloned();
    // 通知（沒有 id）：收到就好
    let Some(id) = id else {
        respond(&stream, "202 Accepted", None);
        return;
    };
    let m = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let result = match m {
        "initialize" => {
            let ver = req.pointer("/params/protocolVersion").and_then(|v| v.as_str()).unwrap_or("2025-06-18");
            json!({ "protocolVersion": ver, "capabilities": { "tools": {} }, "serverInfo": { "name": "verso", "version": env!("CARGO_PKG_VERSION") } })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools.lock().unwrap().clone() }),
        "tools/call" => {
            let name = req.pointer("/params/name").cloned().unwrap_or(Value::Null);
            let args = req.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            let n = next.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = channel();
            pending.lock().unwrap().insert(n, tx);
            let _ = app.emit("ai-call", json!({ "id": n, "name": name, "arguments": args }));
            match rx.recv_timeout(Duration::from_secs(120)) {
                Ok((value, is_error)) => json!({ "content": [{ "type": "text", "text": if value.is_string() { value.as_str().unwrap().to_string() } else { value.to_string() } }], "isError": is_error }),
                Err(_) => {
                    pending.lock().unwrap().remove(&n);
                    json!({ "content": [{ "type": "text", "text": "Verso did not answer in time." }], "isError": true })
                }
            }
        }
        _ => {
            respond(&stream, "200 OK", Some(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } })));
            return;
        }
    };
    respond(&stream, "200 OK", Some(&json!({ "jsonrpc": "2.0", "id": id, "result": result })));
}

/// 開本機 MCP 服務（已經開著就沿用）；tools 是給 Claude 看的工具清單
#[tauri::command]
pub fn ai_server_start(app: AppHandle, state: State<Ai>, tools: Value) -> Result<(), String> {
    *state.tools.lock().unwrap() = tools;
    let mut server = state.server.lock().unwrap();
    if server.is_some() { return Ok(()); }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let key = token();
    *server = Some((port, key.clone()));
    let (tools, pending, next) = (state.tools.clone(), state.pending.clone(), state.next.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, key, tools, pending, next) = (app.clone(), key.clone(), tools.clone(), pending.clone(), next.clone());
            std::thread::spawn(move || handle(stream, app, key, tools, pending, next));
        }
    });
    Ok(())
}

/// 畫面處理完一次工具呼叫，把結果交回去
#[tauri::command]
pub fn ai_reply(state: State<Ai>, id: u64, result: Value, is_error: bool) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) { let _ = tx.send((result, is_error)); }
}

/// 找命令列版的 Claude Code：PATH 裡的，或 npm、官方安裝程式裝的位置
fn find_claude() -> Option<std::path::PathBuf> {
    let mut list: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        for d in std::env::split_paths(&path) { list.push(d.join("claude.exe")); }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        list.push(std::path::Path::new(&appdata).join("npm").join("node_modules").join("@anthropic-ai").join("claude-code").join("bin").join("claude.exe"));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        let home = std::path::Path::new(&home);
        list.push(home.join(".local").join("bin").join("claude.exe"));
        // 公司電腦的 APPDATA 有時指到別的磁碟（漫遊設定檔），npm 卻裝在使用者資料夾底下
        list.push(home.join("AppData").join("Roaming").join("npm").join("node_modules").join("@anthropic-ai").join("claude-code").join("bin").join("claude.exe"));
    }
    list.into_iter().find(|p| p.is_file())
}

/// 在背景執行 Claude Code：只能用 Verso 給的工具。做完（或被停止）時發出 ai-done
#[tauri::command]
pub fn ai_run(app: AppHandle, state: State<Ai>, prompt: String, model: Option<String>, effort: Option<String>) -> Result<(), String> {
    let (port, key) = state.server.lock().unwrap().clone().ok_or("AI 服務還沒開")?;
    let exe = find_claude().ok_or("not-installed")?;
    let mut child_slot = state.child.lock().unwrap();
    if child_slot.is_some() { return Err("busy".into()); }
    // 設定檔放在 Verso 自己的暫存資料夾，Claude 也在那裡執行（不碰其他資料夾）
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("ai");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cfg = dir.join("mcp.json");
    let conf = json!({ "mcpServers": { "verso": { "type": "http", "url": format!("http://127.0.0.1:{}/mcp", port), "headers": { "Authorization": format!("Bearer {}", key) } } } });
    std::fs::write(&cfg, conf.to_string()).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.current_dir(&dir)
        .arg("-p").arg(&prompt)
        .arg("--mcp-config").arg(&cfg)
        .arg("--strict-mcp-config")
        // 內建工具只留 Skill（讀 skill 用），其他（指令、檔案、網路等）都拿掉；沒有事先允許的一律拒絕、不問
        .arg("--tools").arg("Skill")
        .arg("--allowedTools").arg("mcp__verso,Skill")
        .arg("--permission-mode").arg("dontAsk")
        // 專案設定的模型和 effort（只收固定的幾個值）
        .args(model.filter(|m| ["opus", "sonnet", "haiku", "fable"].contains(&m.as_str())).map(|m| vec!["--model".to_string(), m]).unwrap_or_default())
        .args(effort.filter(|e| ["low", "medium", "high", "xhigh", "max"].contains(&e.as_str())).map(|e| vec!["--effort".to_string(), e]).unwrap_or_default())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // 不跳出命令列視窗
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take();
    let err = child.stderr.take();
    *child_slot = Some(child);
    let slot = state.child.clone();
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut o) = out { let _ = o.read_to_string(&mut text); }
        let mut etext = String::new();
        if let Some(mut e) = err { let _ = e.read_to_string(&mut etext); }
        let status = slot.lock().unwrap().take().and_then(|mut c| c.wait().ok());
        let ok = status.map(|s| s.success()).unwrap_or(false);
        let tail = |s: &str| s.chars().rev().take(2000).collect::<String>().chars().rev().collect::<String>();
        let _ = app.emit("ai-done", json!({ "ok": ok, "output": tail(&text), "error": tail(&etext) }));
    });
    Ok(())
}

/// 停止：結束背景的 Claude Code（已經寫回 Verso 的保留）
#[tauri::command]
pub fn ai_stop(state: State<Ai>) {
    if let Some(c) = state.child.lock().unwrap().as_mut() { let _ = c.kill(); }
}
