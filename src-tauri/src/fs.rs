//! 文件树 + 文件操作 —— 工作台「文件」面板的后端。纯 std（+ trash 做回收站删除），
//! 不引 walkdir/ignore（守体积红线）。
//!
//! 读：`list_dir(path)` 单层懒加载，前端点开目录再请求子层。`read_text_file` 只读文本预览。
//! 写：新建 / 重命名 / 复制 / 删除（进回收站，可恢复 —— 符合「写入可回滚、绝不静默覆盖」红线）。
//! 系统集成：在资源管理器中显示、用默认程序打开。

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

/// 默认隐藏的噪声目录（前端可不展示）。文件树照常列出，但标记之。
fn is_noise(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | ".cache" | ".next" | "dist" | "__pycache__"
    )
}

/// 列一层目录。目录在前、各自按名（忽略大小写）排序，最多 2000 条。
#[tauri::command]
pub fn list_dir(path: String, show_noise: Option<bool>) -> Result<Vec<DirEntry>, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err(format!("不是目录: {path}"));
    }
    let show_noise = show_noise.unwrap_or(false);
    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();

    let rd = std::fs::read_dir(p).map_err(|e| format!("读取目录失败: {e}"))?;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if !show_noise && is_noise(&name) {
            continue;
        }
        let meta = match ent.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let item = DirEntry {
            name,
            path: ent.path().to_string_lossy().to_string(),
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
        };
        if is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
        if dirs.len() + files.len() >= 2000 {
            break;
        }
    }

    let by_name = |a: &DirEntry, b: &DirEntry| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.append(&mut files);
    Ok(dirs)
}

/// 读文本文件（只读预览）。限 max_bytes（默认 256KB），超出截断；疑似二进制（含 NUL）拒读。
#[tauri::command]
pub fn read_text_file(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let limit = max_bytes.unwrap_or(256 * 1024);
    let bytes = std::fs::read(&path).map_err(|e| format!("读取失败: {e}"))?;
    let truncated = bytes.len() > limit;
    let slice = &bytes[..bytes.len().min(limit)];
    // 含 NUL 视为二进制，不预览
    if slice.contains(&0) {
        return Err("二进制文件，不支持预览".into());
    }
    let mut s = String::from_utf8_lossy(slice).to_string();
    if truncated {
        s.push_str("\n\n…（文件过大，仅显示前 256KB）");
    }
    Ok(s)
}

// ============================================================
// 文件操作（新建 / 重命名 / 复制 / 删除）
// ============================================================

/// 新建文件夹。已存在同名项则报错（不静默覆盖）。
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("已存在同名项".into());
    }
    std::fs::create_dir_all(p).map_err(|e| format!("新建文件夹失败: {e}"))
}

/// 新建空文件。已存在同名项则报错（不静默覆盖）；父目录不存在则一并建。
#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err("已存在同名项".into());
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(p, b"").map_err(|e| format!("新建文件失败: {e}"))
}

/// 重命名 / 移动。目标已存在则报错（不覆盖）。
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("目标已存在同名项".into());
    }
    std::fs::rename(&from, &to).map_err(|e| format!("重命名失败: {e}"))
}

/// 复制文件或目录（粘贴用）。目标已存在则报错（不覆盖）。
#[tauri::command]
pub fn copy_path(from: String, to: String) -> Result<(), String> {
    let src = Path::new(&from);
    let dst = Path::new(&to);
    if dst.exists() {
        return Err("目标已存在同名项".into());
    }
    if src.is_dir() {
        copy_dir_recursive(src, dst).map_err(|e| format!("复制失败: {e}"))
    } else {
        std::fs::copy(src, dst)
            .map(|_| ())
            .map_err(|e| format!("复制失败: {e}"))
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 删除到回收站（可恢复）。不做永久删除 —— 符合「写入可回滚、绝不静默毁用户数据」红线。
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("删除失败: {e}"))
}

// ============================================================
// 系统集成
// ============================================================

/// 在系统文件管理器中显示并选中该项（Windows 资源管理器 / macOS 访达 / Linux 文件管理器）。
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{path}"));
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.args(["-R", &path]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        // Linux 无通用「选中」，退而打开所在目录
        let dir = Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let mut c = std::process::Command::new("xdg-open");
        c.arg(dir);
        c
    };
    cmd.spawn()
        .map_err(|e| format!("打开文件管理器失败: {e}"))?;
    Ok(())
}

/// 用系统默认程序打开路径（HTML → 默认浏览器，图片 → 图片查看器，等）。
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // explorer 兼作通用 opener：文件用默认程序、目录用资源管理器
        let mut c = std::process::Command::new("explorer");
        c.arg(&path);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&path);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&path);
        c
    };
    cmd.spawn().map_err(|e| format!("打开失败: {e}"))?;
    Ok(())
}
