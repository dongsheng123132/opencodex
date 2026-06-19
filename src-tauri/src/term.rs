//! 应用内真终端（PTY）—— Rust 拥有伪终端，前端 xterm.js 只渲染 + 转发输入。
//!
//! ## 为什么自己起 PTY 而不弹外部窗口
//! 外部 PowerShell 用 `-NoProfile` 又不注入 PATH，导致 openclaw/hermes 找不到命令。
//! 这里复用 `paths::search_paths`（统一口径的 PATH），把便携 Node、
//! `%APPDATA%\npm`、便携 Python Scripts 等目录前置进子 shell 的 PATH —— openclaw/hermes
//! 因此能直接跑。
//!
//! ## 生命周期
//! 一个会话 = 一个长驻 shell。收起抽屉只隐藏 UI，不杀进程（openclaw gateway 继续跑）。
//! 输出走 Tauri Channel 流回前端；键盘经 `term_write` 写回 PTY stdin。
//!
//! ## panic=abort 安全
//! release profile 是 `panic="abort"`，reader 线程内一旦 panic 会整体 abort。
//! 因此 reader/writer 热路径**零 unwrap/expect**，全部 `let _ =` / `if let Ok`。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
#[cfg(windows)]
use std::os::windows::process::CommandExt; // taskkill 用 creation_flags 隐藏黑框

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use crate::paths::path_prefix;

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// 这个会话跑的是哪个工具（claude/codex/openclaw/hermes…）；纯终端无 tag。
    /// 运行面板（list_running）据此聚合「哪些工具在跑」。
    tool: Option<String>,
}

fn sessions() -> &'static Mutex<HashMap<String, PtySession>> {
    static S: OnceLock<Mutex<HashMap<String, PtySession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 单调递增会话 id（不引 uuid）。
fn next_id() -> String {
    static N: OnceLock<Mutex<u64>> = OnceLock::new();
    let m = N.get_or_init(|| Mutex::new(0));
    let mut g = match m.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *g += 1;
    format!("t{}", *g)
}

/// 前置便携工具目录的 PATH（与 agent/config 同口径），让 claude/codex/openclaw 等可解析。
fn build_path() -> String {
    path_prefix()
}

fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}

/// OpenClaw 数据根：`$HOME/.opencodex/openclaw`。
/// 若终端里跑 OpenClaw，gateway 与 CLI 共享它 → 连同一本地 gateway。
/// （对纯 claude/codex 用法无害；仅当用户真用 openclaw 时才会用到。）
fn openclaw_home() -> String {
    crate::paths::app_home()
        .join("openclaw")
        .display()
        .to_string()
}

/// 给终端注入 OPENCLAW_* 环境变量 —— 让 OpenCodex 终端里 `openclaw gateway run` 起的 gateway
/// 和其他终端的 `openclaw` CLI 共享同一 home，从而能调它的能力（含 word/excel/ppt 办公技能）。
fn inject_openclaw_env(builder: &mut CommandBuilder) {
    let home = openclaw_home();
    let _ = std::fs::create_dir_all(&home);
    builder.env("OPENCLAW_HOME", &home);
    builder.env("OPENCLAW_STATE_DIR", &home);
    builder.env("OPENCLAW_DISABLE_BONJOUR", "1"); // 便携环境禁 mDNS 广播，免端口/实例碰撞
}

/// cwd 选择：传入路径非空且确为已存在目录则用它，否则回落 home。
/// （工作台按任务文件夹开终端用；原底部抽屉传 None → 行为不变。）
fn resolve_cwd(cwd: Option<String>) -> String {
    cwd.map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty() && std::path::Path::new(p).is_dir())
        .unwrap_or_else(home_dir)
}

/// 待运行命令校验：放宽到支持带参命令（`claude --resume`、`codex --model x` 等），
/// 同时挡住 shell 注入。
///
/// 规则：按空格切 token —— 首 token（程序名）必须在固定允许集内；其余每个 token 只允许
/// `[A-Za-z0-9-_=./:]` 且不含 `..`（防元字符注入与路径穿越）。空命令直接拒绝。
fn validate_cmd(cmd: &str) -> bool {
    const ALLOWED_PROGRAMS: &[&str] =
        &["claude", "codex", "openclaw", "hermes", "opencode", "node", "npm", "git"];
    let mut tokens = cmd.split_whitespace();
    let Some(prog) = tokens.next() else {
        return false;
    };
    if !ALLOWED_PROGRAMS.contains(&prog) {
        return false;
    }
    tokens.all(|t| {
        !t.contains("..")
            && t.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_=./:".contains(c))
    })
}

/// Windows 下定位 PowerShell 7（pwsh.exe）：用户 profile 里的别名/UTF-8 配置都依赖它。
/// 先查标准安装路径，再退回系统 PATH 上的 `pwsh.exe`；都没有返回 None（回落 5.1）。
#[cfg(windows)]
fn find_pwsh7() -> Option<String> {
    // 标准安装位置（系统级 / 用户级）
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for env in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(env) {
            candidates.push(std::path::Path::new(&base).join("PowerShell").join("7").join("pwsh.exe"));
        }
    }
    for c in candidates {
        if c.exists() {
            return Some(c.display().to_string());
        }
    }
    // 退回系统 PATH 上的 pwsh.exe（pwsh 7 安装时通常会写进 PATH）
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            if dir.is_empty() {
                continue;
            }
            let p = std::path::Path::new(dir).join("pwsh.exe");
            if p.exists() {
                return Some(p.display().to_string());
            }
        }
    }
    None
}

/// 构造交互式 shell 命令。Windows 优先 PowerShell 7（pwsh），保留用户 profile
/// （别名 cc/cx/gem、UTF-8 等都在里面）；没装 7 则回退 Windows PowerShell 5.1。
/// 都不加 -NoProfile（要用户 profile 里的 PATH/别名），我们额外前置便携目录。
#[cfg(windows)]
fn shell_builder() -> CommandBuilder {
    let exe = find_pwsh7().unwrap_or_else(|| "powershell.exe".into());
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(["-NoLogo"]);
    cmd
}

#[cfg(not(windows))]
fn shell_builder() -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd
}

/// 无头自检：起一个 PTY 跑一条命令，把输出收集回来（验证 PATH 注入 + ConPTY 正常）。
/// 给 `--term-test <cmd>` 用，不依赖 GUI / xterm。
pub fn headless_run(cmd: &str, timeout_ms: u64) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 100, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut builder = shell_builder();
    builder.env("PATH", build_path());
    builder.env("TERM", "xterm-256color");
    inject_openclaw_env(&mut builder);
    builder.cwd(home_dir());
    let mut child = pair.slave.spawn_command(builder).map_err(|e| format!("spawn: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
    let mut writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;

    let out = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
    let out2 = out.clone();
    let t = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(mut g) = out2.lock() {
                        g.extend_from_slice(&buf[..n]);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let _ = writer.write_all(cmd.as_bytes());
    let _ = writer.write_all(b"\r\n");
    let _ = writer.write_all(b"exit\r\n");
    let _ = writer.flush();

    // 简单超时等待
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < timeout_ms as u128 {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let _ = child.kill();
    drop(pair.master);
    let _ = t.join();

    let g = out.lock().map_err(|_| "lock")?;
    Ok(String::from_utf8_lossy(&g).to_string())
}

/// 起一个 PTY 会话。返回 session_id；输出通过 `on_data` Channel 流回前端。
#[tauri::command]
pub async fn term_open(
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    initial_cmd: Option<String>,
    cwd: Option<String>,
    tool: Option<String>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty 失败: {e}"))?;

    let mut builder = shell_builder();
    builder.env("PATH", build_path());
    builder.env("TERM", "xterm-256color");
    inject_openclaw_env(&mut builder);
    builder.cwd(resolve_cwd(cwd));

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("启动 shell 失败: {e}"))?;
    // slave 端关掉，否则 reader 永远等不到 EOF
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader 失败: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer 失败: {e}"))?;

    let id = next_id();

    // reader 线程：PTY 输出 → Channel（零 unwrap，panic=abort 安全）
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    if let Ok(mut map) = sessions().lock() {
        map.insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer,
                child,
                tool,
            },
        );
    }

    // 待运行命令（白名单校验：放宽到带参命令，挡 shell 注入，见 validate_cmd）
    if let Some(cmd) = initial_cmd {
        let cmd = cmd.trim().to_string();
        if validate_cmd(&cmd) {
            if let Ok(mut map) = sessions().lock() {
                if let Some(s) = map.get_mut(&id) {
                    let _ = s.writer.write_all(cmd.as_bytes());
                    let _ = s.writer.write_all(b"\r\n");
                    let _ = s.writer.flush();
                }
            }
        }
    }

    Ok(id)
}

/// 键盘输入 → PTY stdin。
#[tauri::command]
pub fn term_write(session_id: String, data: String) -> Result<(), String> {
    let mut map = sessions().lock().map_err(|_| "终端会话锁异常")?;
    let s = map.get_mut(&session_id).ok_or("会话不存在")?;
    s.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))?;
    let _ = s.writer.flush();
    Ok(())
}

/// 终端尺寸变化。
#[tauri::command]
pub fn term_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = sessions().lock().map_err(|_| "终端会话锁异常")?;
    let s = map.get(&session_id).ok_or("会话不存在")?;
    s.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize 失败: {e}"))
}

/// 杀掉整棵进程树（含子孙）。
///
/// 关键：`child.kill()` 只杀顶层 shell（pwsh.exe），里面跑的 `claude`/`node`/`codex`
/// 等子进程会变孤儿继续占内存/CPU/端口 —— 开关几轮终端后机器堆满孤儿进程 → 卡、不稳定。
/// 因此关闭前先按 PID 杀整棵树（Crystal 同款做法）。
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        // /T = 连同子进程树，/F = 强制。失败（进程已退）忽略。
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，别闪黑框
            .output();
    }
    #[cfg(not(windows))]
    {
        // 负 PID = 杀整个进程组（spawn 时进程会成为组长）。先 TERM 再 KILL。
        let p = pid as i32;
        let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{p}")]).output();
        let _ = std::process::Command::new("kill").args(["-KILL", &format!("-{p}")]).output();
    }
}

/// 关闭会话（杀整棵进程树 + 释放）。
#[tauri::command]
pub fn term_close(session_id: String) -> Result<(), String> {
    if let Ok(mut map) = sessions().lock() {
        if let Some(mut s) = map.remove(&session_id) {
            // 先按 PID 杀整棵树（带走 claude/node 等子进程），再 kill 兜底。
            if let Some(pid) = s.child.process_id() {
                kill_tree(pid);
            }
            let _ = s.child.kill();
            // master drop 后 reader 见 EOF 退出
        }
    }
    Ok(())
}

/// 一个运行中的工具实例（运行面板用）。
#[derive(serde::Serialize)]
pub struct RunningTool {
    pub tool: String,
    pub session_id: String,
}

/// 列出当前正在运行的「带工具 tag」的 PTY 会话（运行面板据此显示绿点 + 停止按钮）。
/// 顺手把已死的会话清掉（child.try_wait() 返回 Some 即已退出）。
#[tauri::command]
pub fn list_running() -> Vec<RunningTool> {
    let mut out = Vec::new();
    let mut dead: Vec<String> = Vec::new();
    if let Ok(mut map) = sessions().lock() {
        for (id, s) in map.iter_mut() {
            // 已退出的会话标记待清
            if matches!(s.child.try_wait(), Ok(Some(_))) {
                dead.push(id.clone());
                continue;
            }
            if let Some(tool) = &s.tool {
                out.push(RunningTool {
                    tool: tool.clone(),
                    session_id: id.clone(),
                });
            }
        }
        for id in dead {
            map.remove(&id);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::validate_cmd;

    #[test]
    fn allows_plain_and_parametered() {
        assert!(validate_cmd("claude"));
        assert!(validate_cmd("claude --resume"));
        assert!(validate_cmd("codex --model gpt-5.3-codex"));
        assert!(validate_cmd("openclaw gateway run --port 18789"));
        assert!(validate_cmd("npm install -g openclaw"));
    }

    #[test]
    fn rejects_injection_and_unknown_programs() {
        assert!(!validate_cmd(""));
        assert!(!validate_cmd("rm -rf /"));
        assert!(!validate_cmd("claude; rm -rf x")); // ';' 不在字符集
        assert!(!validate_cmd("claude && evil"));
        assert!(!validate_cmd("claude | tee out"));
        assert!(!validate_cmd("git ../escape")); // 路径穿越
        assert!(!validate_cmd("powershell -c whoami")); // 程序名不在白名单
    }
}
