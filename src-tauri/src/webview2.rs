//! WebView2 启动前自检。
//!
//! 绿色版复用系统 WebView2；若运行库缺失，Tauri 在创建窗口前就会失败，应用内提示根本
//! 无法执行。因此这里仅用 Win32 原生对话框，在 Builder 之前取得用户同意后才下载安装。

#[cfg(windows)]
pub const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
#[cfg(windows)]
pub const DOWNLOAD_PAGE: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome { Ready, Installed, Declined, Failed }

#[cfg(windows)]
pub fn ensure() -> Outcome {
    if installed() { return Outcome::Ready; }
    if !ask_yes_no(
        "OpenCodex 需要 Microsoft Edge WebView2 运行库来显示界面。\n\n这台电脑还没有该运行库。现在从微软官方下载并安装吗？（约 1 分钟）\n\n选择“否”会打开官方下载页，安装后请重新启动 OpenCodex。",
        "OpenCodex · 缺少 WebView2",
    ) {
        open_url(DOWNLOAD_PAGE);
        return Outcome::Declined;
    }
    if install_runtime() && installed() { return Outcome::Installed; }
    alert("WebView2 自动安装没有完成。已打开微软官方下载页；安装完成后请重新启动 OpenCodex。", "OpenCodex · 安装未完成");
    open_url(DOWNLOAD_PAGE);
    Outcome::Failed
}

#[cfg(not(windows))]
pub fn ensure() -> Outcome { Outcome::Ready }

#[cfg(windows)]
fn installed() -> bool {
    if ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"].iter().filter_map(|v| std::env::var(v).ok()).any(|base| {
        let dir = std::path::Path::new(&base).join("Microsoft").join("EdgeWebView").join("Application");
        std::fs::read_dir(dir).map(|it| it.filter_map(Result::ok).any(|e| e.path().is_dir() && e.file_name().to_string_lossy().chars().next().is_some_and(|c| c.is_ascii_digit()))).unwrap_or(false)
    }) { return true; }

    const CLIENT: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    [
        format!("HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT}"),
        format!("HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT}"),
        format!("HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT}"),
    ].iter().any(|key| {
        no_window(std::process::Command::new("reg").args(["query", key, "/v", "pv"])).output().ok().is_some_and(|o| {
            o.status.success() && String::from_utf8_lossy(&o.stdout).lines().any(|line| line.trim_start().starts_with("pv") && line.split_whitespace().last().is_some_and(|v| v.chars().any(|c| c.is_ascii_digit() && c != '0')))
        })
    })
}

#[cfg(windows)]
fn install_runtime() -> bool {
    let tmp = std::env::temp_dir().join("opencodex-webview2-setup.exe");
    let _ = std::fs::remove_file(&tmp);
    let downloaded = no_window(std::process::Command::new("curl.exe").args(["-fL", "--connect-timeout", "20", "--max-time", "300", "-o", &tmp.to_string_lossy(), BOOTSTRAPPER_URL])).status().map(|s| s.success()).unwrap_or(false);
    let installed = downloaded && tmp.exists() && no_window(std::process::Command::new(&tmp).args(["/silent", "/install"])).status().map(|s| s.success()).unwrap_or(false);
    let _ = std::fs::remove_file(&tmp);
    installed
}

#[cfg(windows)]
fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000)
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

#[cfg(windows)]
extern "system" {
    fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
    fn ShellExecuteW(hwnd: *mut core::ffi::c_void, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
}

#[cfg(windows)]
fn ask_yes_no(text: &str, caption: &str) -> bool {
    unsafe { MessageBoxW(std::ptr::null_mut(), wide(text).as_ptr(), wide(caption).as_ptr(), 0x0000_0004 | 0x0000_0030 | 0x0001_0000) == 6 }
}

#[cfg(windows)]
fn alert(text: &str, caption: &str) {
    unsafe { MessageBoxW(std::ptr::null_mut(), wide(text).as_ptr(), wide(caption).as_ptr(), 0x0000_0010 | 0x0001_0000); }
}

#[cfg(windows)]
fn open_url(url: &str) {
    unsafe { ShellExecuteW(std::ptr::null_mut(), wide("open").as_ptr(), wide(url).as_ptr(), std::ptr::null(), std::ptr::null(), 1); }
}
