/** 工作台数据类型 —— 与 Rust src-tauri/src/tasks.rs 的 Task 字段一一对应。 */

export type PanelKind = "terminal" | "files" | "browser" | "chat";
export type TaskStatus = "idle" | "running" | "waiting_input" | "done" | "error";
export type TaskSource = "manual" | "context_menu" | "im";

/** 右侧区可显示的面板（中间 ChatPanel 永远独占，不在此集合）。 */
export type RightKind = "terminal" | "browser" | "files";

/** 每个会话的三区布局（运行时内存，不落盘）。中=对话恒在；右=可切+收起；下=终端抽屉。 */
export interface PanelLayout {
  rightKind: RightKind; // 右侧区当前显示
  rightOpen: boolean; // 右侧区展开/收起（收起则中对话独占全宽）
  rightRatio: number; // 中:右 宽度比 0.35~0.85
  drawerOpen: boolean; // 底部终端抽屉
  drawerHeight: number; // 抽屉高度 px
}

export interface Task {
  id: string; // 任务唯一 id（前端按文件夹生成）
  name: string; // 显示名（默认文件夹名）
  dir: string; // 绑定文件夹绝对路径
  status: TaskStatus; // 气泡染色 + IM 查询
  source: TaskSource; // 来源
  assignee: string | null; // IM 预留：指派给谁
  external_ref: string | null; // IM 预留：外部消息/会话 id
  last_opened_at: number;
  created_at: number;
  // —— Phase 7：工具型会话（从「我的 AI」运行面板启动的工具实例）——
  tool?: string | null; // claude/codex/openclaw/hermes…；任务型为空
  startup_cmd?: string | null; // 启动命令（如 "openclaw gateway run"）
  kind?: "task" | "tool"; // 默认 task
  // —— Phase 8：项目分组键（=规范化 dir）。同一文件夹可开多个会话，左侧按 project 分组 ——
  project?: string | null;
}

/** 规范化目录路径（去尾斜杠 + 小写），作项目分组键。 */
export function normDir(dir: string): string {
  return dir.replace(/[\\/]+$/, "").toLowerCase();
}

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

/** 任务名取文件夹名（路径末段）。 */
export function dirBasename(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || dir;
}

/** 用文件夹路径生成稳定 id（同一文件夹 → 同一任务，避免重复）。 */
export function taskIdFromDir(dir: string): string {
  const norm = dir.replace(/[\\/]+$/, "").toLowerCase();
  let h = 0;
  for (let i = 0; i < norm.length; i++) {
    h = (h * 31 + norm.charCodeAt(i)) | 0;
  }
  return "t" + (h >>> 0).toString(36);
}
