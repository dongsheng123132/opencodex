//! 工作台「任务」持久化 —— 每个任务绑一个文件夹，落盘 `~/.opencodex/tasks.json`。
//!
//! ## 为什么落盘成单一 JSON
//! 任务来源（应用内选文件夹 / 命令行 --open-dir 透传）统一写进这份文件。
//! 重启后最近任务还在，右键打开的目录也自动 upsert 成任务。
//!
//! ## IM 预留（这版不做微信，但口子留好）
//! `Task` 带 `status` / `assignee` / `external_ref` / `source`。将来的微信网关进程只要读写
//! `~/.opencodex/tasks.json` 就能查询任务状态。
//! 所以这些字段现在就持久化，UI 暂时只用 `status` 染色。
//!
//! 纯 std + serde_json，零新依赖。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// 任务唯一 id（前端生成或后端补；当前由前端按文件夹生成）
    pub id: String,
    /// 显示名（默认取文件夹名，可重命名）
    pub name: String,
    /// 绑定的文件夹绝对路径
    pub dir: String,
    /// 状态：idle | running | waiting_input | done | error（气泡染色 + IM 查询）
    #[serde(default = "default_status")]
    pub status: String,
    /// 来源：manual | context_menu | im
    #[serde(default = "default_source")]
    pub source: String,
    /// IM 预留：指派给谁（微信用户 id 等）
    #[serde(default)]
    pub assignee: Option<String>,
    /// IM 预留：外部消息 / 会话 id
    #[serde(default)]
    pub external_ref: Option<String>,
    /// 最近打开时间（毫秒，排序用）
    #[serde(default)]
    pub last_opened_at: i64,
    /// 创建时间（毫秒）
    #[serde(default)]
    pub created_at: i64,
    /// Phase 7：工具型会话绑的工具（claude/openclaw…）；任务型为 None
    #[serde(default)]
    pub tool: Option<String>,
    /// Phase 7：启动命令（如 "openclaw gateway run"）
    #[serde(default)]
    pub startup_cmd: Option<String>,
    /// Phase 7：task | tool（default task）
    #[serde(default = "default_kind")]
    pub kind: String,
    /// 手动排序权重：0 = 未排（按最近打开置顶，兼容旧数据）；>0 = 显式顺序，越小越靠前。
    /// 由 `reorder_tasks` 整体赋值（1-based）。新建会话保持 0 → 自动冒到顶部。
    #[serde(default)]
    pub order: i64,
}

fn default_status() -> String {
    "idle".into()
}
fn default_source() -> String {
    "manual".into()
}
fn default_kind() -> String {
    "task".into()
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TasksFile {
    version: u32,
    tasks: Vec<Task>,
}

fn tasks_path() -> PathBuf {
    crate::paths::app_home().join("tasks.json")
}

/// 当前毫秒时间戳（i64）。文件不存在等异常时返回 0。
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_file() -> TasksFile {
    std::fs::read_to_string(tasks_path())
        .ok()
        .and_then(|s| serde_json::from_str::<TasksFile>(&s).ok())
        .unwrap_or(TasksFile {
            version: 1,
            tasks: Vec::new(),
        })
}

fn write_file(f: &TasksFile) -> Result<(), String> {
    let _ = std::fs::create_dir_all(crate::paths::app_home());
    let s = serde_json::to_string_pretty(f).map_err(|e| format!("序列化任务失败: {e}"))?;
    std::fs::write(tasks_path(), s).map_err(|e| format!("写入 tasks.json 失败: {e}"))
}

/// 列出全部任务。手动排序优先：`order > 0` 按升序（用户拖出来的顺序）；
/// `order == 0`（未排 / 新建）视为置顶，组内再按最近打开倒序——保持「新会话冒顶」的老手感。
#[tauri::command]
pub fn list_tasks() -> Vec<Task> {
    let mut f = read_file();
    f.tasks.sort_by(|a, b| {
        let ka = if a.order == 0 { i64::MIN } else { a.order };
        let kb = if b.order == 0 { i64::MIN } else { b.order };
        ka.cmp(&kb).then(b.last_opened_at.cmp(&a.last_opened_at))
    });
    f.tasks
}

/// 新增 / 更新一个任务（按 id 去重）。每次 upsert 都刷新 last_opened_at（置顶）。
/// created_at 仅首次写入时设。返回写盘后的该任务。
#[tauri::command]
pub fn upsert_task(mut task: Task) -> Result<Task, String> {
    if task.id.trim().is_empty() || task.dir.trim().is_empty() {
        return Err("任务缺少 id 或 dir".into());
    }
    let now = now_ms();
    task.last_opened_at = now;

    let mut f = read_file();
    if let Some(existing) = f.tasks.iter_mut().find(|t| t.id == task.id) {
        // 保留原 created_at 与手动排序权重 order；其余字段以传入为准。
        // （前端 Task 不一定回传 order，重新 upsert 不能把用户拖好的顺序冲掉。）
        task.created_at = if existing.created_at > 0 {
            existing.created_at
        } else {
            now
        };
        task.order = existing.order;
        *existing = task.clone();
    } else {
        if task.created_at == 0 {
            task.created_at = now;
        }
        f.tasks.push(task.clone());
    }
    f.version = 1;
    write_file(&f)?;
    Ok(task)
}

/// 删除一个任务（仅从列表移除，不动文件夹本身）。
#[tauri::command]
pub fn remove_task(id: String) -> Result<(), String> {
    let mut f = read_file();
    f.tasks.retain(|t| t.id != id);
    write_file(&f)
}

/// 重排任务顺序。传入「全部条目 id 的目标顺序」，按位置给持久化任务赋 `order`（1-based）。
/// 运行时工具会话不落盘，传进来的此类 id 找不到、自动跳过——只持久化真正的任务型会话顺序。
/// 不在 `ids` 里的任务保持原 order（理论上不会发生）。
#[tauri::command]
pub fn reorder_tasks(ids: Vec<String>) -> Result<(), String> {
    let mut f = read_file();
    for (i, id) in ids.iter().enumerate() {
        if let Some(t) = f.tasks.iter_mut().find(|t| &t.id == id) {
            t.order = (i as i64) + 1;
        }
    }
    write_file(&f)
}
