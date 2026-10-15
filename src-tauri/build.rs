fn main() {
    // 外掛：src/plugins/<名稱> 在才編進去（AI、雲端）；資料夾刪掉就是沒有那個功能的 Verso
    for name in ["ai", "cloud"] {
        println!("cargo:rustc-check-cfg=cfg(verso_{})", name);
        if std::path::Path::new(&format!("src/plugins/{}/mod.rs", name)).exists() {
            println!("cargo:rustc-cfg=verso_{}", name);
        }
    }
    // 外掛資料夾加入或刪掉時要重新判斷
    println!("cargo:rerun-if-changed={}", if std::path::Path::new("src/plugins").exists() { "src/plugins" } else { "src" });
    google_client();
    tauri_build::build()
}

/// 雲端模式的 Google 用戶端 ID 和密鑰：打包時從專案外面的檔案讀進來（不放進 GitHub），
/// 使用者就不用自己填。檔案在 ../../簽章金鑰/google-client.json（或環境變數 VERSO_GOOGLE_CLIENT_FILE 指定的位置），
/// 內容是 {"client_id": "…", "client_secret": "…"}；沒有這個檔案就不內建
fn google_client() {
    println!("cargo:rerun-if-env-changed=VERSO_GOOGLE_CLIENT_FILE");
    let path = std::env::var("VERSO_GOOGLE_CLIENT_FILE").unwrap_or_else(|_| "../../簽章金鑰/google-client.json".into());
    println!("cargo:rerun-if-changed={}", path);
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    for (key, env) in [("client_id", "VERSO_GOOGLE_CLIENT_ID"), ("client_secret", "VERSO_GOOGLE_CLIENT_SECRET")] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) { println!("cargo:rustc-env={}={}", env, s.trim()); }
    }
}
