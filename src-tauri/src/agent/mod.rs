//! AI Agent 驱动 —— 结构化复原 Codex 能力（Phase 4+）。
//!
//! 终端面板（term.rs）渲染裸 TUI；这里走结构化事件流，给 claude/codex 加卡片面板。

pub mod claude;
mod protocol;
