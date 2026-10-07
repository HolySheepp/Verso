use tauri::Manager;

/// 列出電腦已安裝的字形（字體設定用），去掉重複並排序
#[tauri::command]
fn list_fonts() -> Vec<String> {
    let mut names = font_kit::source::SystemSource::new()
        .all_families()
        .unwrap_or_default();
    names.retain(|n| !n.trim().is_empty() && !n.starts_with('@'));
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// 把檔案或資料夾移到資源回收筒
#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// 這個 Verso 是安裝版還是攜帶版：安裝版的 exe 旁邊有解除安裝程式
#[tauri::command]
fn install_kind() -> String {
    let installed = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").exists()))
        .unwrap_or(false);
    if installed { "installed".into() } else { "portable".into() }
}

/// 用預設瀏覽器打開網址（攜帶版打開下載頁用）
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/HolySheepp/Verso/") {
        return Err("不允許的網址".into());
    }
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 把資料夾設成隱藏（暫存復原資料夾用）
#[tauri::command]
fn hide_path(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("attrib")
            .args(["+h", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 只能開一個 Verso：再開一次時，把已開的視窗還原並帶到最上層
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.webview_windows().values().next() {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_fonts, move_to_trash, install_kind, open_url, hide_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
