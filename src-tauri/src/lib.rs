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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_fonts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
