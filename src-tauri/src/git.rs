//! Git worktree 操作封装。
//! 用 std::process::Command 调系统 git，零新依赖。
//! git_is_repo 仅检查 .git 目录，不调 git 命令。

use std::path::Path;

/// 检测 path 是否是 git 仓库（检查 .git 目录/文件存在即可，不调 git 命令）。
#[tauri::command]
pub fn git_is_repo(path: String) -> bool {
    Path::new(&path).join(".git").exists()
}

/// 列出仓库本地分支名。
#[tauri::command]
pub fn git_list_branches(path: String) -> Result<Vec<String>, String> {
    let out = std::process::Command::new("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("执行 git 失败: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// 创建 worktree。
///
/// - `repo_root`：主仓库根目录
/// - `branch`：分支名（已有分支 或 新分支名）
/// - `create_branch`：true → 加 -b 新建；false → checkout 已有分支
///
/// worktree 目录：`<repo_root 父目录>/<repo_name>-<branch 斜杠替换成连字符>`
/// 返回新目录的绝对路径（供前端写进 Task.dir）。
#[tauri::command]
pub fn git_create_worktree(
    repo_root: String,
    branch: String,
    create_branch: bool,
) -> Result<String, String> {
    let repo_path = Path::new(&repo_root);
    let repo_name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo");
    let parent = repo_path.parent().ok_or("无法获取仓库父目录")?;

    // "feature/login" → "feature-login"
    let sanitized = branch
        .replace(['/', '\\', ' ', ':'], "-")
        .trim_matches('-')
        .to_string();
    let new_dir = parent.join(format!("{}-{}", repo_name, sanitized));
    let new_dir_str = new_dir
        .to_str()
        .ok_or("新目录路径含非 UTF-8 字符")?
        .to_string();

    if new_dir.exists() {
        return Err(format!("目录已存在: {}", new_dir_str));
    }

    let mut cmd = std::process::Command::new("git");
    cmd.arg("worktree").arg("add");
    if create_branch {
        cmd.arg("-b").arg(&branch).arg(&new_dir_str);
    } else {
        cmd.arg(&new_dir_str).arg(&branch);
    }
    cmd.current_dir(&repo_root);

    let out = cmd.output().map_err(|e| format!("执行 git 失败: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(new_dir_str)
}

/// 删除 worktree（移除磁盘目录 + git 元数据）。
#[tauri::command]
pub fn git_remove_worktree(
    repo_root: String,
    worktree_path: String,
) -> Result<(), String> {
    let out = std::process::Command::new("git")
        .args(["worktree", "remove", "--force", &worktree_path])
        .current_dir(&repo_root)
        .output()
        .map_err(|e| format!("执行 git 失败: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}
