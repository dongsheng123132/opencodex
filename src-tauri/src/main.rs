// 阻止 Windows release 构建弹出多余的命令行黑窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    opencodex_lib::run()
}
