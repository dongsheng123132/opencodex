//! 终端快捷命令按钮 —— 用户自定义的常用词/命令（如 `/model`、`ccd`），点一下发进终端。
//!
//! 内置按钮（claude/codex/openclaw…）在前端写死，不动；这里只存「用户额外添加」的，
//! 落盘 `~/.opencodex/quick_cmds.json`。纯 std + serde_json，零新依赖。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCmd {
    /// 按钮显示文字
    pub label: String,
    /// 点了发进终端执行的命令（会自动补回车）
    pub cmd: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct QuickFile {
    #[serde(default)]
    cmds: Vec<QuickCmd>,
}

fn quick_path() -> PathBuf {
    crate::paths::app_home().join("quick_cmds.json")
}

fn read_file() -> QuickFile {
    std::fs::read_to_string(quick_path())
        .ok()
        .and_then(|s| serde_json::from_str::<QuickFile>(&s).ok())
        .unwrap_or_default()
}

/// 列出用户自定义的快捷命令。
#[tauri::command]
pub fn get_quick_cmds() -> Vec<QuickCmd> {
    read_file().cmds
}

/// 整体保存用户自定义快捷命令（前端增/删后传全量）。label 去空、去重。
#[tauri::command]
pub fn set_quick_cmds(cmds: Vec<QuickCmd>) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    let cmds: Vec<QuickCmd> = cmds
        .into_iter()
        .filter(|c| !c.label.trim().is_empty() && !c.cmd.trim().is_empty())
        .filter(|c| seen.insert(c.label.trim().to_string()))
        .map(|c| QuickCmd { label: c.label.trim().into(), cmd: c.cmd.trim().into() })
        .collect();
    let _ = std::fs::create_dir_all(crate::paths::app_home());
    let s = serde_json::to_string_pretty(&QuickFile { cmds })
        .map_err(|e| format!("序列化快捷命令失败: {e}"))?;
    std::fs::write(quick_path(), s).map_err(|e| format!("写入 quick_cmds.json 失败: {e}"))
}
