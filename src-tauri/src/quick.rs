//! 终端快捷命令按钮 —— 默认项和用户添加项共用一份可编辑列表。
//!
//! 首次使用给 `claude / codex / codex 可回滚 / hermes`，之后以 `~/.opencodex/quick_cmds.json`
//! 为唯一真相源；即使用户删空也保持空，不会在下次启动偷偷补回来。

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
    version: u32,
    #[serde(default)]
    cmds: Vec<QuickCmd>,
}

const QUICK_FILE_VERSION: u32 = 2;

fn quick_path() -> PathBuf {
    crate::paths::app_home().join("quick_cmds.json")
}

fn default_cmds() -> Vec<QuickCmd> {
    vec![
        QuickCmd {
            label: "claude".into(),
            cmd: "claude".into(),
        },
        QuickCmd {
            label: "codex".into(),
            cmd: "codex".into(),
        },
        QuickCmd {
            label: "codex ↕".into(),
            cmd: "codex --no-alt-screen".into(),
        },
        QuickCmd {
            label: "hermes".into(),
            cmd: "hermes".into(),
        },
    ]
}

fn read_file() -> Option<QuickFile> {
    std::fs::read_to_string(quick_path())
        .ok()
        .and_then(|s| serde_json::from_str::<QuickFile>(&s).ok())
}

/// 列出全部快捷命令。仅文件尚不存在时返回首次默认值；已保存的空列表也是有效配置。
#[tauri::command]
pub fn get_quick_cmds() -> Vec<QuickCmd> {
    let Some(mut file) = read_file() else {
        return default_cmds();
    };
    // v2 只追加一次「Codex 可回滚」。用户之后删掉也不会在下次启动被补回。
    if file.version < QUICK_FILE_VERSION {
        let previous_cmds = file.cmds.clone();
        // 只给仍保留原 codex 按钮的旧清单补充；用户若早已删掉 codex 或删空，就尊重该选择。
        if !file.cmds.iter().any(|c| c.cmd == "codex --no-alt-screen") {
            if let Some(codex_index) = file.cmds.iter().position(|c| c.cmd == "codex") {
                let at = codex_index + 1;
                file.cmds.insert(
                    at,
                    QuickCmd {
                        label: "codex ↕".into(),
                        cmd: "codex --no-alt-screen".into(),
                    },
                );
            }
        }
        file.version = QUICK_FILE_VERSION;
        // 版本号和新项必须一起落盘；写失败就仍返回旧清单，不制造「看似加了、重启又变」的假状态。
        if write_file(&file).is_err() {
            return previous_cmds;
        }
    }
    file.cmds
}

fn write_file(file: &QuickFile) -> Result<(), String> {
    let _ = std::fs::create_dir_all(crate::paths::app_home());
    let s = serde_json::to_string_pretty(file).map_err(|e| format!("序列化快捷命令失败: {e}"))?;
    std::fs::write(quick_path(), s).map_err(|e| format!("写入 quick_cmds.json 失败: {e}"))
}

/// 整体保存全部快捷命令（前端增/删/改/排序后传全量）。label 去空、去重。
#[tauri::command]
pub fn set_quick_cmds(cmds: Vec<QuickCmd>) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    let cmds: Vec<QuickCmd> = cmds
        .into_iter()
        .filter(|c| !c.label.trim().is_empty() && !c.cmd.trim().is_empty())
        .filter(|c| seen.insert(c.label.trim().to_string()))
        .map(|c| QuickCmd {
            label: c.label.trim().into(),
            cmd: c.cmd.trim().into(),
        })
        .collect();
    write_file(&QuickFile {
        version: QUICK_FILE_VERSION,
        cmds,
    })
}

/// 恢复首次默认值。默认清单只在这里定义，避免前后端各维护一份后漂移。
#[tauri::command]
pub fn reset_quick_cmds() -> Result<Vec<QuickCmd>, String> {
    let cmds = default_cmds();
    set_quick_cmds(cmds.clone())?;
    Ok(cmds)
}
