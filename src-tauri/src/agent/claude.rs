//! Claude Code stream-json 驱动 —— 把 claude 的结构化事件流解析成 Codex 式卡片。
//!
//! ## 为什么不走 PTY
//! 终端面板（term.rs）已经把 claude 的 TUI 原样渲染了。这里要的是**结构化**：plan 清单、
//! 工具卡片、内联 diff、token 用量。靠 `claude --output-format stream-json` 吐 JSON 事件流，
//! Rust 逐行解析成统一事件，经 Tauri Channel 推前端，React 渲染成卡片。与终端面板并存。
//!
//! ## 进程模型（MVP：一轮一进程 + --resume 续接）
//! claude `-p`（print）模式是一次性的：跑完一轮就退出。多轮对话靠 `--resume <session_id>`
//! 续接上一轮的 session（首轮没有 session_id）。这避免了 stdin 双向管道的复杂度，纯 std 即可。
//! 一个任务记住自己最近的 session_id（HashMap<task_id, last_session_id>）。
//!
//! ## 零依赖
//! 纯 std Command + 线程读管道 + serde_json。PATH 复用 paths::search_paths（让 claude 可解析）。
//! release 是 panic=abort：reader 线程热路径零 unwrap。

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tauri::ipc::Channel;

use crate::config;
use crate::paths::{path_prefix, resolve_exe};
use crate::proxy;

use super::protocol::ProtocolState;

/// 每个任务记住最近一轮的 claude session_id（用于 --resume 多轮续接）。
fn last_sessions() -> &'static Mutex<HashMap<String, String>> {
    static S: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 正在运行的 claude 子进程（用于中断）。task_id -> Child。
fn running() -> &'static Mutex<HashMap<String, Child>> {
    static R: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(windows)]
fn base_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new(resolve_exe(program));
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

#[cfg(not(windows))]
fn base_command(program: &str) -> std::process::Command {
    std::process::Command::new(resolve_exe(program))
}

/// 前置便携工具目录（与 term / config 同口径），让 `claude` 可解析。
fn inject_path(c: &mut std::process::Command) {
    c.env("PATH", path_prefix());
    config::apply_model_env_to_command(c);
    proxy::apply_to_command(c);
}

/// 给一个任务发一条消息，跑一轮 claude，结构化事件经 `on_event` Channel 流回前端。
///
/// - `task_id`：工作台任务 id（同一任务多轮会 --resume）
/// - `prompt`：用户消息
/// - `cwd`：任务文件夹（claude 在此目录工作）
/// - `model`：可选模型覆盖
#[tauri::command]
pub async fn claude_send(
    task_id: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    // 在阻塞线程里跑，避免卡 async runtime
    tauri::async_runtime::spawn_blocking(move || run_turn(task_id, prompt, cwd, model, on_event))
        .await
        .map_err(|e| format!("claude 任务调度失败: {e}"))?
}

fn run_turn(
    task_id: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    // 取上一轮 session_id（有则 --resume 续接）
    let resume = last_sessions()
        .lock()
        .ok()
        .and_then(|m| m.get(&task_id).cloned());

    let mut c = base_command("claude");
    c.arg("--output-format").arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .arg("--permission-mode").arg("bypassPermissions"); // MVP 先免审批
    if let Some(m) = &model {
        if !m.trim().is_empty() {
            c.arg("--model").arg(m);
        }
    }
    if let Some(sid) = &resume {
        c.arg("--resume").arg(sid);
    }
    c.arg("-p").arg(&prompt);

    if let Some(d) = cwd.as_deref().filter(|p| std::path::Path::new(p).is_dir()) {
        c.current_dir(d);
    }
    inject_path(&mut c);
    c.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());

    let mut child = c
        .spawn()
        .map_err(|e| format!("启动 claude 失败（是否已安装？）: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 把 child 存进 running，供中断
    if let Ok(mut m) = running().lock() {
        // 同任务旧进程先清掉句柄（理论上不会有，保险）
        m.insert(task_id.clone(), child);
    }

    // stderr 收集（claude 的报错 / 非 JSON 噪声）
    let err_buf = std::sync::Arc::new(Mutex::new(String::new()));
    let err_store = err_buf.clone();
    let err_h = stderr.map(|se| {
        std::thread::spawn(move || {
            for line in BufReader::new(se).lines().map_while(Result::ok) {
                if let Ok(mut g) = err_store.lock() {
                    g.push_str(&line);
                    g.push('\n');
                }
            }
        })
    });

    // stdout 逐行解析 stream-json
    let mut state = ProtocolState::new(resume.is_some());
    if let Some(so) = stdout {
        for line in BufReader::new(so).lines().map_while(Result::ok) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue; // 非 JSON 行（极少）忽略
            };
            for ev in state.map_event(&v) {
                // 记住 session_id 供下轮 --resume
                if ev.get("kind").and_then(|k| k.as_str()) == Some("session") {
                    if let Some(sid) = ev.get("session_id").and_then(|s| s.as_str()) {
                        if let Ok(mut m) = last_sessions().lock() {
                            m.insert(task_id.clone(), sid.to_string());
                        }
                    }
                }
                let _ = on_event.send(ev);
            }
        }
    }
    if let Some(h) = err_h {
        let _ = h.join();
    }

    // 取回 child wait + 从 running 移除
    let child_opt = running().lock().ok().and_then(|mut m| m.remove(&task_id));
    let interrupted;
    let code;
    match child_opt {
        Some(mut ch) => {
            // 若已被 interrupt kill，wait 会立刻返回
            let status = ch.wait().map_err(|e| format!("等待 claude 失败: {e}"))?;
            code = status.code();
            interrupted = !status.success() && code.is_none();
        }
        None => {
            // 被中断移走了
            interrupted = true;
            code = None;
        }
    }

    let err_text = err_buf.lock().map(|g| g.trim().to_string()).unwrap_or_default();
    // 收尾事件：成功/中断/错误
    let done = if interrupted {
        serde_json::json!({ "kind": "done", "status": "interrupted" })
    } else if code == Some(0) {
        serde_json::json!({ "kind": "done", "status": "ok" })
    } else {
        serde_json::json!({
            "kind": "done", "status": "error",
            "code": code, "message": err_text
        })
    };
    let _ = on_event.send(done);
    Ok(())
}

/// 中断某任务正在跑的 claude（kill 子进程）。
#[tauri::command]
pub fn claude_interrupt(task_id: String) -> Result<(), String> {
    if let Ok(mut m) = running().lock() {
        if let Some(mut ch) = m.remove(&task_id) {
            let _ = ch.kill();
        }
    }
    Ok(())
}

/// 清掉某任务的多轮上下文（下次从新会话开始，不 --resume）。
#[tauri::command]
pub fn claude_reset(task_id: String) -> Result<(), String> {
    if let Ok(mut m) = last_sessions().lock() {
        m.remove(&task_id);
    }
    Ok(())
}
