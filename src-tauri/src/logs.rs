//! 本地 bug / 错误收集 —— 纯本地、无上报、无服务器。
//!
//! 前端全局错误（window.onerror / unhandledrejection / console.error）、invoke 失败，
//! 以及 Rust panic，统一落到 `~/.opencodex/logs/opencodex.jsonl`（每行一条 JSON）。
//! 开发期可直接 `grep` / 复盘，或前端调 `read_recent_logs` 在 App 里看。
//!
//! 文件超上限自动滚动（丢前半、保留最近），不会无限长大。
//!
//! ## 可插拔
//! 删本文件 + lib.rs 的注册块（`mod logs;` / 4 个 command / `install_panic_hook`）
//! + 前端 `bugtrap.ts` 即可完全移除，不动其他任何模块。

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// 日志上限 2MB —— 超了把前半截掉，只保留最近的记录。绿色软件不该把磁盘写满。
const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn logs_dir() -> PathBuf {
    crate::paths::app_home().join("logs")
}

fn log_path() -> PathBuf {
    logs_dir().join("opencodex.jsonl")
}

/// 一条日志记录（前端传来或 Rust 内部构造）。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct LogRecord {
    /// 时间字符串（前端给本地 `toLocaleString()`；Rust 侧 panic 给 UTC）
    pub ts: String,
    /// 级别：error / warn / panic
    pub level: String,
    /// 来源：window.onerror / unhandledrejection / console.error / invoke:xxx / rust-panic
    pub source: String,
    /// 摘要
    pub msg: String,
    /// 详情（堆栈 / 位置 / 额外字段），可空
    #[serde(default)]
    pub detail: String,
}

/// 追加一条记录（超上限先滚动）。失败一律静默 —— 日志不该反过来把 App 弄崩。
pub fn append(rec: &LogRecord) {
    let _ = std::fs::create_dir_all(logs_dir());
    let path = log_path();
    rotate_if_needed(&path);
    if let Ok(line) = serde_json::to_string(rec) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// 文件超上限：保留后半（最近的），从中点后第一个换行起截断，避免切碎某一行。
fn rotate_if_needed(path: &PathBuf) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() <= MAX_BYTES {
        return;
    }
    if let Ok(data) = std::fs::read(path) {
        let mid = data.len() / 2;
        let start = data[mid..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|i| mid + i + 1)
            .unwrap_or(mid);
        let _ = std::fs::write(path, &data[start..]);
    }
}

/// 前端写一条日志。
#[tauri::command]
pub fn app_log(rec: LogRecord) {
    append(&rec);
}

/// 读最近 N 条（倒序，最新在前）—— 给 App 内查看 / 开发复盘。
#[tauri::command]
pub fn read_recent_logs(limit: usize) -> Vec<LogRecord> {
    let Ok(data) = std::fs::read_to_string(log_path()) else {
        return Vec::new();
    };
    data.lines()
        .rev()
        .take(limit.max(1))
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// 清空日志。
#[tauri::command]
pub fn clear_logs() -> Result<(), String> {
    let p = log_path();
    if p.exists() {
        std::fs::write(&p, b"").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 日志文件全路径（前端展示 / 调系统打开用）。
#[tauri::command]
pub fn logs_path() -> String {
    log_path().display().to_string()
}

/// 安装 Rust panic 钩子。`panic=abort` 下进程随后会 abort，但钩子在 abort 前能跑一遍，
/// 先把 panic 信息落盘 —— 崩了也有据可查（含 reader/writer 热路径的意外 panic）。
pub fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        append(&LogRecord {
            ts: now_utc(),
            level: "panic".into(),
            source: "rust-panic".into(),
            msg: info.to_string(),
            detail: loc,
        });
        prev(info);
    }));
}

/// epoch → `YYYY-MM-DD HH:MM:SS UTC`（无 chrono，Howard Hinnant civil_from_days 手算）。
fn now_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86400, secs % 86400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02} UTC")
}
