//! Claude stream-json 事件解析 —— 精读 OpenCovibe claude_protocol.rs 提炼的最小规格。
//!
//! 输入：claude `--output-format stream-json` 逐行吐的原始 JSON Value。
//! 输出：统一事件 `{kind, ...}`，前端 ChatPanel 渲染成卡片。
//!
//! ## 为什么有状态（不能无状态逐行 map）
//! - 工具调用的参数（input）是 `input_json_delta` 分片到达的，要按 tool_use_id 累积拼接。
//! - tool_result 只带 tool_use_id 不带工具名，要查 `id->name` 映射还原。
//! - 多轮会话里 system/init 会重复出现，只首个发「会话开始」。
//!
//! ## 输出事件 kind
//! - session：会话 init（session_id / model / cwd / tools）
//! - text：流式文本片段（delta）
//! - tool_start：工具开始（id / name）
//! - tool_input：工具参数就绪（id / name / input；含 Edit/Write 时前端渲染内联 diff）
//! - tool_end：工具结果（id / name / output / is_error）
//! - usage：turn 结束用量（input/output/cache tokens / cost / duration）

use std::collections::HashMap;
use serde_json::{json, Value};

pub struct ProtocolState {
    /// tool_use_id -> 工具名（tool_result 还原名字用）
    emitted_tool_ids: HashMap<String, String>,
    /// tool_use_id -> 累积的 input partial_json
    input_json_accum: HashMap<String, String>,
    /// 最近启动的 tool_use_id（HashMap 无序，记最近的）
    last_tool_use_id: Option<String>,
    /// 已收 result（防重复收尾）
    got_result_event: bool,
    /// 本轮是 --resume 续接（首个 init 不算「新会话」）
    is_resume: bool,
    /// 已见首个 system/init
    seen_first_init: bool,
}

impl ProtocolState {
    pub fn new(is_resume: bool) -> Self {
        Self {
            emitted_tool_ids: HashMap::new(),
            input_json_accum: HashMap::new(),
            last_tool_use_id: None,
            got_result_event: false,
            is_resume,
            seen_first_init: false,
        }
    }

    /// 把一行原始 JSON 映射成 0..n 个统一事件。
    pub fn map_event(&mut self, v: &Value) -> Vec<Value> {
        // stream_event 是嵌套 wrapper，解包一层
        if v.get("type").and_then(|t| t.as_str()) == Some("stream_event") {
            if let Some(inner) = v.get("event") {
                return self.map_event(inner);
            }
            return vec![];
        }

        match v.get("type").and_then(|t| t.as_str()) {
            Some("system") => self.on_system(v),
            Some("content_block_start") => self.on_block_start(v),
            Some("content_block_delta") => self.on_block_delta(v),
            Some("assistant") => self.on_assistant(v),
            Some("user") => self.on_user(v),
            Some("result") => self.on_result(v),
            _ => vec![],
        }
    }

    fn on_system(&mut self, v: &Value) -> Vec<Value> {
        if v.get("subtype").and_then(|s| s.as_str()) != Some("init") {
            return vec![];
        }
        let first = !self.seen_first_init;
        self.seen_first_init = true;
        // 续接轮的首个 init 不当「新会话开始」，但 session_id 仍要透传给上层记忆
        let mut ev = json!({
            "kind": "session",
            "session_id": v.get("session_id").and_then(|s| s.as_str()).unwrap_or(""),
            "model": v.get("model").and_then(|s| s.as_str()).unwrap_or(""),
            "cwd": v.get("cwd").and_then(|s| s.as_str()).unwrap_or(""),
            "fresh": first && !self.is_resume,
        });
        if let Some(tools) = v.get("tools") {
            ev["tools"] = tools.clone();
        }
        vec![ev]
    }

    fn on_block_start(&mut self, v: &Value) -> Vec<Value> {
        let block = v.get("content_block");
        if block.and_then(|b| b.get("type")).and_then(|t| t.as_str()) != Some("tool_use") {
            return vec![];
        }
        let id = block
            .and_then(|b| b.get("id"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        let name = block
            .and_then(|b| b.get("name"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        if !id.is_empty() {
            self.emitted_tool_ids.insert(id.clone(), name.clone());
            self.input_json_accum.insert(id.clone(), String::new());
            self.last_tool_use_id = Some(id.clone());
        }
        vec![json!({ "kind": "tool_start", "id": id, "name": name })]
    }

    fn on_block_delta(&mut self, v: &Value) -> Vec<Value> {
        let delta = v.get("delta");
        match delta.and_then(|d| d.get("type")).and_then(|t| t.as_str()) {
            Some("text_delta") => {
                let text = delta
                    .and_then(|d| d.get("text"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if text.is_empty() {
                    vec![]
                } else {
                    vec![json!({ "kind": "text", "text": text })]
                }
            }
            Some("input_json_delta") => {
                // 累积工具参数分片到最近的 tool_use_id
                if let Some(id) = self.last_tool_use_id.clone() {
                    let frag = delta
                        .and_then(|d| d.get("partial_json"))
                        .and_then(|s| s.as_str())
                        .unwrap_or("");
                    if let Some(buf) = self.input_json_accum.get_mut(&id) {
                        buf.push_str(frag);
                    }
                }
                vec![]
            }
            _ => vec![],
        }
    }

    fn on_assistant(&mut self, v: &Value) -> Vec<Value> {
        let content = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array());
        let Some(blocks) = content else {
            return vec![];
        };
        let mut out = Vec::new();
        for b in blocks {
            match b.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    let text = b.get("text").and_then(|s| s.as_str()).unwrap_or("");
                    if !text.is_empty() {
                        out.push(json!({ "kind": "text_done", "text": text }));
                    }
                }
                Some("tool_use") => {
                    // 完整工具块：参数就绪 → 发 tool_input（前端据此渲染卡片/内联 diff）
                    let id = b.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let name = b.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    if !id.is_empty() {
                        self.emitted_tool_ids.insert(id.clone(), name.clone());
                    }
                    let input = b.get("input").cloned().unwrap_or(Value::Null);
                    out.push(json!({
                        "kind": "tool_input",
                        "id": id, "name": name, "input": input,
                    }));
                }
                _ => {}
            }
        }
        out
    }

    fn on_user(&mut self, v: &Value) -> Vec<Value> {
        let content = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array());
        let Some(blocks) = content else {
            return vec![];
        };
        let mut out = Vec::new();
        for b in blocks {
            if b.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }
            let id = b
                .get("tool_use_id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let name = self
                .emitted_tool_ids
                .get(&id)
                .cloned()
                .unwrap_or_default();
            // content 可能是字符串或数组（多模态），取字符串部分
            let output = match b.get("content") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Array(arr)) => arr
                    .iter()
                    .filter_map(|x| x.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            };
            let is_error = b.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
            out.push(json!({
                "kind": "tool_end",
                "id": id, "name": name,
                "output": output, "is_error": is_error,
            }));
        }
        out
    }

    fn on_result(&mut self, v: &Value) -> Vec<Value> {
        if self.got_result_event {
            return vec![];
        }
        self.got_result_event = true;
        let usage = v.get("usage");
        let get = |k: &str| -> i64 {
            usage
                .and_then(|u| u.get(k))
                .and_then(|x| x.as_i64())
                .unwrap_or(0)
        };
        vec![json!({
            "kind": "usage",
            "input_tokens": get("input_tokens"),
            "output_tokens": get("output_tokens"),
            "cache_read_tokens": get("cache_read_input_tokens"),
            "cache_creation_tokens": get("cache_creation_input_tokens"),
            // 真实字段名是 total_cost_usd（兼容 cost_usd 兜底）
            "cost_usd": v.get("total_cost_usd")
                .or_else(|| v.get("cost_usd"))
                .and_then(|x| x.as_f64()).unwrap_or(0.0),
            "duration_ms": v.get("duration_ms").and_then(|x| x.as_i64()).unwrap_or(0),
            "subtype": v.get("subtype").and_then(|s| s.as_str()).unwrap_or(""),
        })]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_init_text_tool_result() {
        let mut st = ProtocolState::new(false);
        // init
        let init = serde_json::json!({
            "type":"system","subtype":"init","session_id":"ses-1","model":"claude","cwd":"/tmp"
        });
        let evs = st.map_event(&init);
        assert_eq!(evs[0]["kind"], "session");
        assert_eq!(evs[0]["session_id"], "ses-1");
        assert_eq!(evs[0]["fresh"], true);

        // tool start + result name 还原
        let ts = serde_json::json!({
            "type":"content_block_start",
            "content_block":{"type":"tool_use","id":"t1","name":"Bash"}
        });
        let evs = st.map_event(&ts);
        assert_eq!(evs[0]["kind"], "tool_start");
        assert_eq!(evs[0]["name"], "Bash");

        let ur = serde_json::json!({
            "type":"user",
            "message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok","is_error":false}]}
        });
        let evs = st.map_event(&ur);
        assert_eq!(evs[0]["kind"], "tool_end");
        assert_eq!(evs[0]["name"], "Bash"); // 从 id 还原
        assert_eq!(evs[0]["output"], "ok");
    }

    #[test]
    fn text_delta_and_result() {
        let mut st = ProtocolState::new(false);
        let d = serde_json::json!({
            "type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}
        });
        assert_eq!(st.map_event(&d)[0]["kind"], "text");

        let r = serde_json::json!({
            "type":"result","subtype":"success",
            "usage":{"input_tokens":10,"output_tokens":5},"cost_usd":0.001,"duration_ms":200
        });
        let evs = st.map_event(&r);
        assert_eq!(evs[0]["kind"], "usage");
        assert_eq!(evs[0]["input_tokens"], 10);
        // 重复 result 不再发
        assert!(st.map_event(&r).is_empty());
    }

    #[test]
    fn unwraps_stream_event() {
        let mut st = ProtocolState::new(false);
        let wrapped = serde_json::json!({
            "type":"stream_event",
            "event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}
        });
        assert_eq!(st.map_event(&wrapped)[0]["kind"], "text");
    }
}
