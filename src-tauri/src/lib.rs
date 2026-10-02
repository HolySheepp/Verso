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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_fonts, move_to_trash])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
