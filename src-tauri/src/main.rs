// Windows 發行版不跳出命令列視窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    verso_lib::run()
}
