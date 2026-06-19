//! 通用 key→字符串 持久化 —— 给前端存「不需要后端理解结构」的小状态。
//!
//! 目前用途：终端分屏布局（前端把分屏树序列化成 JSON 字符串，按 task.id 存），
//! 关 App 后重开能恢复「几个格子、怎么分屏」的形状（PTY 进程已死，恢复的是布局不是内容）。
//! 落盘 `~/.opencodex/kv.json`。纯 std + serde_json，零新依赖。

use std::collections::HashMap;
use std::path::PathBuf;

fn kv_path() -> PathBuf {
    crate::paths::app_home().join("kv.json")
}

fn read_all() -> HashMap<String, String> {
    std::fs::read_to_string(kv_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 读一个 key 的值（不存在返回 None）。
#[tauri::command]
pub fn kv_get(key: String) -> Option<String> {
    read_all().remove(&key)
}

/// 写一个 key 的值（value 为 None 则删除该 key）。
#[tauri::command]
pub fn kv_set(key: String, value: Option<String>) -> Result<(), String> {
    let mut all = read_all();
    match value {
        Some(v) => {
            all.insert(key, v);
        }
        None => {
            all.remove(&key);
        }
    }
    let _ = std::fs::create_dir_all(crate::paths::app_home());
    let s = serde_json::to_string_pretty(&all).map_err(|e| format!("序列化 kv 失败: {e}"))?;
    std::fs::write(kv_path(), s).map_err(|e| format!("写入 kv.json 失败: {e}"))
}
