//! 文件树 —— 工作台「文件」面板的后端。纯 std，不引 walkdir/ignore（守体积红线）。
//!
//! 单层懒加载：`list_dir(path)` 只读一层，前端点开目录再请求子层。目录在前、按名排序，
//! 过滤常见噪声目录（.git/node_modules/target），限条数防超大目录卡 UI。
//! `read_text_file` 给只读预览用，限大小防读进大二进制。

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
