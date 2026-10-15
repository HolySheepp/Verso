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
    tauri_build::build()
}
