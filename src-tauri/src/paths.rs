//! 路径与便携运行时定位 —— OpenCodex 子进程 PATH 注入的唯一真相源。
//!
//! 双击启动（Explorer / Finder）给的 PATH 往往不含 npm 全局目录、homebrew 等
//! （它们一般只写进了 shell profile），导致明明装了 claude/codex 却找不到。
//! 所以子进程 PATH 永远前置这几个已知位置，不赌系统 PATH。
//!
//! 纯路径子集 —— 不含任何下载/安装/商业逻辑。

use std::path::{Path, PathBuf};

/// OpenCodex 数据根目录。
///
/// 优先级（只取第一命中的，决定后整进程不变）：
/// 1. `OPENCODEX_HOME` 环境变量（显式指定，最高）。
/// 2. `--data-dir <path>` 命令行参数（U盘/多开隔离用）。
/// 3. exe 同目录 `portable-data/`（存在才用 —— U盘即插即走）。
/// 4. 回落 `$HOME/.opencodex`（默认行为）。
///
/// 多个绿色版共存：各 exe 放不同文件夹 → 各自 `portable-data/` → 数据天然隔离，
/// tasks.json / config.json 互不覆盖。同一目录复制多份 exe 则共享一份数据。
pub fn app_home() -> PathBuf {
    use std::sync::OnceLock;
    static HOME: OnceLock<PathBuf> = OnceLock::new();
    HOME.get_or_init(|| {
        // 1. 环境变量
        if let Ok(v) = std::env::var("OPENCODEX_HOME") {
            let v = v.trim();
            if !v.is_empty() {
                return PathBuf::from(v);
            }
        }
        // 2. --data-dir <path>
        let args: Vec<String> = std::env::args().collect();
        let mut it = args.iter();
        while let Some(a) = it.next() {
            if a == "--data-dir" {
                if let Some(p) = it.next() {
                    if !p.trim().is_empty() {
                        return PathBuf::from(p.trim());
                    }
                }
            }
        }
        // 3. exe 同目录 portable-data/（存在才用）
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let portable = dir.join("portable-data");
                if portable.is_dir() {
                    return portable;
                }
            }
        }
        // 4. 默认 ~/.opencodex
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".into());
        Path::new(&home).join(".opencodex")
    })
    .clone()
}

/// 数据目录是否便携模式（非默认 ~/.opencodex 即便携：--data-dir / OPENCODEX_HOME / exe 旁 portable-data）。
/// 前端用它在「关于」里标注，避免用户分不清两个绿色版用的是哪份数据。
pub fn is_portable() -> bool {
    // 环境变量 / 命令行显式指定 → 便携
    if let Ok(v) = std::env::var("OPENCODEX_HOME") {
        if !v.trim().is_empty() {
            return true;
        }
    }
    let args: Vec<String> = std::env::args().collect();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--data-dir" {
            if let Some(p) = it.next() {
                if !p.trim().is_empty() {
                    return true;
                }
            }
        }
    }
    // exe 旁 portable-data/ 存在 → 便携
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("portable-data").is_dir() {
                return true;
            }
        }
    }
    false
}

/// 用户主目录（终端默认 cwd、config 写入用）。
pub fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}

/// 便携 Node 的可执行目录（已存在才返回）。npm 全局包的启动器也落在这里。
/// Windows：`node/` 本身；macOS/Linux：`node/bin/`。
/// 用户若把便携 Node 解压到 `~/.opencodex/runtime/node` 即被自动发现。
pub fn portable_node_dir() -> Option<PathBuf> {
    let base = app_home().join("runtime").join("node");
    #[cfg(windows)]
    {
        base.join("node.exe").exists().then_some(base)
    }
    #[cfg(not(windows))]
    {
        let bin = base.join("bin");
        bin.join("node").exists().then_some(bin)
    }
}

/// 便携 Python 的 python 可执行文件（已存在才返回）。
pub fn portable_python_exe() -> Option<PathBuf> {
    let base = app_home().join("runtime").join("python");
    #[cfg(windows)]
    {
        let p = base.join("python.exe");
        p.exists().then_some(p)
    }
    #[cfg(not(windows))]
    {
        let p = base.join("bin").join("python3");
        p.exists().then_some(p)
    }
}

/// 便携 Python 装 pip 包后，可执行脚本所在目录。
/// Windows：`python/Scripts`；unix：`python/bin`。
pub fn portable_python_scripts_dir() -> Option<PathBuf> {
    let base = app_home().join("runtime").join("python");
    #[cfg(windows)]
    let d = base.join("Scripts");
    #[cfg(not(windows))]
    let d = base.join("bin");
    d.exists().then_some(d)
}

/// 子进程 PATH 应前置的已知工具目录（顺序即优先级）。
///
/// `extra` 一般传 `portable_node_dir()` —— 便携 Node 排最前。
pub fn search_paths(extra: Option<&Path>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = extra {
        v.push(d.to_path_buf());
    }
    // 便携 Python 的脚本目录 + python 本体目录
    if let Some(s) = portable_python_scripts_dir() {
        v.push(s);
    }
    if let Some(p) = portable_python_exe() {
        if let Some(dir) = p.parent() {
            v.push(dir.to_path_buf());
        }
    }
    #[cfg(windows)]
    {
        // npm 默认全局 prefix，claude.cmd / codex.cmd 在这
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm = Path::new(&appdata).join("npm");
            if npm.exists() {
                v.push(npm);
            }
        }
        // 用户常把 CLI 手动放进 ~/bin、~/.local/bin
        if let Ok(home) = std::env::var("USERPROFILE") {
            for sub in ["bin", ".local/bin"] {
                let p = Path::new(&home).join(sub);
                if p.exists() {
                    v.push(p);
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        // macOS：Finder 启动的 app PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin
        for d in ["/opt/homebrew/bin", "/usr/local/bin"] {
            let p = PathBuf::from(d);
            if p.exists() {
                v.push(p);
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            for sub in [".npm-global/bin", ".local/bin"] {
                let p = Path::new(&home).join(sub);
                if p.exists() {
                    v.push(p);
                }
            }
        }
    }
    v
}

/// 把 `search_paths` 拼成可设进子进程 `PATH` 的字符串（前置于现有 PATH）。
pub fn path_prefix() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let dirs = search_paths(portable_node_dir().as_deref());
    let prefix = dirs
        .iter()
        .map(|d| d.display().to_string())
        .collect::<Vec<_>>()
        .join(sep);
    let old = std::env::var("PATH").unwrap_or_default();
    if prefix.is_empty() {
        old
    } else {
        format!("{prefix}{sep}{old}")
    }
}

/// 把命令名解析成 `search_paths` 里真实存在的可执行文件全路径。
/// Windows 下 `Command::new("claude")` 不会自动找 `claude.cmd`（npm 全局装的是 .cmd），
/// 这里显式找 .cmd/.exe/.bat 全路径；找不到回落原名（让系统 PATH 再试）。
pub fn resolve_exe(program: &str) -> String {
    let exts: &[&str] = if cfg!(windows) {
        &[".cmd", ".exe", ".bat", ""]
    } else {
        &[""]
    };
    for dir in search_paths(portable_node_dir().as_deref()) {
        for ext in exts {
            let p = dir.join(format!("{program}{ext}"));
            if p.exists() {
                return p.display().to_string();
            }
        }
    }
    program.to_string()
}

/// 某个 CLI 是否能在 search_paths 里找到（用于 config 体检 claude/codex 是否已装）。
pub fn tool_installed(program: &str) -> bool {
    let exts: &[&str] = if cfg!(windows) {
        &[".cmd", ".exe", ".bat", ""]
    } else {
        &[""]
    };
    for dir in search_paths(portable_node_dir().as_deref()) {
        for ext in exts {
            if dir.join(format!("{program}{ext}")).exists() {
                return true;
            }
        }
    }
    false
}
