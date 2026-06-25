//! OpenCodex —— 开源、绿色的本地编程工作台（Tauri 入口）。
//!
//! 以「文件夹」为基础组织会话：选一个项目文件夹 → 和你自己的 AI 模型对话 →
//! 需要时从对话顶部开应用内真终端、看文件树、开浏览器。常驻保活，切会话不杀 PTY。
//!
//! 完全本地、无服务器、无内置 Key —— 用户自带模型（DeepSeek / 本地 ollama / 任意
//! OpenAI·Anthropic 兼容端点）。
//!
//! 模块分工：
//! - `paths`   子进程 PATH 注入 + 便携运行时定位（唯一真相源）
//! - `config`  自带模型配置（只写 ~/.opencodex，子进程临时注入 env）
//! - `term`    应用内 PTY 终端（portable_pty）
//! - `tasks`   会话/任务持久化（~/.opencodex/tasks.json）
//! - `agent`   结构化 claude 对话流（stream-json → 卡片）
//! - `fs`      文件面板（list_dir / read_text_file）
//!
//! 暴露给前端的 command 见底部 `invoke_handler`。

mod agent;
mod config;
mod fs;
mod kv;
mod paths;
mod proxy;
mod quick;
mod tasks;
mod term;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 启动时探测到的环境信息（前端用）。
#[derive(Debug, Clone, Serialize)]
struct AppEnv {
    /// 平台（windows / macos / linux）
    platform: String,
    /// 用户主目录（默认会话用，不必先选文件夹即可开聊）
    home_dir: String,
    /// 命令行 `--open-dir` 透传进来的目录（CLI 集成预留），无则空
    opened_dir: Option<String>,
}

#[tauri::command]
fn get_env() -> AppEnv {
    AppEnv {
        platform: std::env::consts::OS.to_string(),
        home_dir: paths::home_dir(),
        opened_dir: parse_open_dir_arg(),
    }
}

/// 读系统剪贴板文本。WebView2 的 navigator.clipboard 在 xterm 焦点下常被拒，
/// 改走 Rust 直读，终端粘贴 100% 可靠。读不到（无文本/空）返回空串。
#[tauri::command]
fn clipboard_read() -> Result<String, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    Ok(cb.get_text().unwrap_or_default())
}

/// 写系统剪贴板文本（终端选区复制用）。
#[tauri::command]
fn clipboard_write(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

/// 把窗口隐藏（最小化到任务栏行为交给系统；这里仅供前端可选调用）。
#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// 工作台「浏览器」面板：在独立 webview 子窗口打开 URL（localhost / https）。
/// 用子窗口而非 iframe，因 localhost 开发服务器与很多文档站带 X-Frame-Options 会被 deny。
/// label 形如 `browser-<taskId>`，每任务一个，复用则导航。
#[tauri::command]
async fn open_browser(app: AppHandle, url: String, label: String) -> Result<(), String> {
    let ok = url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("https://");
    if !ok {
        return Err("只允许 https 或 http://localhost".into());
    }
    if !label.starts_with("browser-") {
        return Err("非法窗口标识".into());
    }
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        let _ = w.eval(&format!("window.location.href={url:?}"));
        return Ok(());
    }
    let parsed = url.parse().map_err(|_| "地址解析失败".to_string())?;
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("OpenCodex · 浏览器")
        .inner_size(1000.0, 720.0)
        .center()
        .resizable(true)
        .build()
        .map_err(|e| format!("打开浏览器窗口失败: {e}"))?;
    Ok(())
}

// ============================================================
// 辅助
// ============================================================

/// 解析命令行 `--open-dir <path>`（CLI / 右键集成预留）。
fn parse_open_dir_arg() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--open-dir" {
            if let Some(p) = it.next() {
                if !p.is_empty() {
                    return Some(p.clone());
                }
            }
        }
    }
    None
}

// ============================================================
// 入口
// ============================================================

pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // 终端无头验证：opencodex --term-test "<cmd>"（验证 PTY + PATH 注入，不依赖 GUI）
    if let Some(i) = args.iter().position(|a| a == "--term-test") {
        let cmd = args.get(i + 1).cloned().unwrap_or_else(|| "node --version".into());
        match term::headless_run(&cmd, 8000) {
            Ok(out) => {
                println!("{out}");
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("term-test 失败: {e}");
                std::process::exit(1);
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_env,
            hide_window,
            open_browser,
            clipboard_read,
            clipboard_write,
            config::get_config,
            config::set_config,
            term::term_open,
            term::term_write,
            term::term_resize,
            term::term_close,
            term::list_running,
            tasks::list_tasks,
            tasks::upsert_task,
            tasks::remove_task,
            tasks::reorder_tasks,
            quick::get_quick_cmds,
            quick::set_quick_cmds,
            kv::kv_get,
            kv::kv_set,
            agent::claude::claude_send,
            agent::claude::claude_interrupt,
            agent::claude::claude_reset,
            fs::list_dir,
            fs::read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("启动 OpenCodex 失败");
}
