fn main() {
    // 外掛：src/plugins/ai 在才把 AI 編進去；資料夾刪掉就是沒有 AI 的 Verso
    println!("cargo:rustc-check-cfg=cfg(verso_ai)");
    if std::path::Path::new("src/plugins/ai/mod.rs").exists() {
        println!("cargo:rustc-cfg=verso_ai");
    }
    // 外掛資料夾加入或刪掉時要重新判斷
    println!("cargo:rerun-if-changed={}", if std::path::Path::new("src/plugins").exists() { "src/plugins" } else { "src" });
    tauri_build::build()
}
