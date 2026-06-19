//! 自带模型配置（Bring Your Own Model）—— 纯本地，不连任何服务器。
//!
//! OpenCodex 不内置任何 API Key、不指向任何中转站。用户在「设置」里填自己的：
//!   - Base URL（任何 OpenAI / Anthropic 兼容端点，如 DeepSeek、本地 ollama、自建中转）
//!   - API Key
//!   - 模型名 / 小模型名
//!
//! 写入两处：
//!   1. `~/.opencodex/config.json` —— 本应用自己的配置记录（前端回显用）
//!   2. `~/.claude/settings.json` 的 `env` 块 —— 让 `claude` CLI（对话面板 claude_send 调它）
//!      用上用户选的端点。只动我们管理的 5 个 env 键，其余配置不碰（cc-switch 式）。
//!
//! 这样对话面板（agent/claude.rs 跑 `claude -p`）就能用用户自己的模型，真正开源、无锁定。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::{home_dir, tool_installed};

/// 用户填的模型配置。空字段表示「不设置/官方默认」。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelConfig {
    /// Anthropic 兼容 Base URL（claude CLI 用），如 https://api.deepseek.com/anthropic
    #[serde(default)]
    pub base_url: String,
    /// API Key
    #[serde(default)]
    pub api_key: String,
    /// 主模型名
    #[serde(default)]
    pub model: String,
    /// 小/快模型名（claude 的 SMALL_FAST_MODEL）
    #[serde(default)]
    pub small_model: String,
}

/// 体检结果（前端「是否可对话」判断用，取代旧 detect_stack + get_driver_status）。
#[derive(Debug, Clone, Serialize)]
pub struct ConfigStatus {
    /// 当前配置（回显，api_key 已脱敏）
    pub config: ModelConfig,
    /// claude CLI 是否能找到
    pub claude_installed: bool,
    /// codex CLI 是否能找到
    pub codex_installed: bool,
    /// 是否已配好可对话（有 base_url + api_key，或已装 claude 并自带配置）
    pub ready: bool,
}

fn config_path() -> PathBuf {
    crate::paths::app_home().join("config.json")
}

fn claude_settings_path() -> PathBuf {
    PathBuf::from(home_dir()).join(".claude").join("settings.json")
}

/// 读本应用配置（不存在返回空）。
fn read_config() -> ModelConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str::<ModelConfig>(&s).ok())
        .unwrap_or_default()
}

/// api_key 脱敏：只留前后各 4 位。
fn mask_key(k: &str) -> String {
    let n = k.chars().count();
    if n <= 8 {
        if k.is_empty() {
            String::new()
        } else {
            "•".repeat(n)
        }
    } else {
        let head: String = k.chars().take(4).collect();
        let tail: String = k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        format!("{head}…{tail}")
    }
}

/// 我们在 `~/.claude/settings.json` `env` 里管理的键 —— 只动这几个，其余不碰。
const MANAGED_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
];

/// 把用户配置写进 `~/.claude/settings.json` 的 env 块（cc-switch 式：只增删我们的键）。
fn apply_to_claude(cfg: &ModelConfig) -> Result<(), String> {
    let path = claude_settings_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建 .claude 目录失败: {e}"))?;
    }
    // 读现有 settings.json（保留用户其它配置），无则空对象
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let env = obj
        .entry("env".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !env.is_object() {
        *env = serde_json::json!({});
    }
    let env = env.as_object_mut().unwrap();

    // 先清掉我们管理的键，再按非空写回（空 = 不设置，回落官方默认）
    for k in MANAGED_KEYS {
        env.remove(*k);
    }
    let put = |env: &mut serde_json::Map<String, serde_json::Value>, k: &str, v: &str| {
        if !v.trim().is_empty() {
            env.insert(k.to_string(), serde_json::Value::String(v.trim().to_string()));
        }
    };
    put(env, "ANTHROPIC_BASE_URL", &cfg.base_url);
    put(env, "ANTHROPIC_AUTH_TOKEN", &cfg.api_key);
    put(env, "ANTHROPIC_MODEL", &cfg.model);
    put(env, "ANTHROPIC_SMALL_FAST_MODEL", &cfg.small_model);

    let s = serde_json::to_string_pretty(&root).map_err(|e| format!("序列化 settings 失败: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("写入 settings.json 失败: {e}"))
}

/// 取当前配置 + 环境体检（前端启动/进设置时调）。api_key 已脱敏。
#[tauri::command]
pub fn get_config() -> ConfigStatus {
    let cfg = read_config();
    let claude_installed = tool_installed("claude");
    let codex_installed = tool_installed("codex");
    let configured = !cfg.base_url.trim().is_empty() && !cfg.api_key.trim().is_empty();
    let masked = ModelConfig {
        base_url: cfg.base_url.clone(),
        api_key: mask_key(&cfg.api_key),
        model: cfg.model.clone(),
        small_model: cfg.small_model.clone(),
    };
    ConfigStatus {
        config: masked,
        claude_installed,
        codex_installed,
        // 可对话：装了 claude 且（配了自定义端点 或 用户已自行配好官方）
        ready: claude_installed && (configured || has_claude_env()),
    }
}

/// `~/.claude/settings.json` 里是否已有 base_url（用户自己配过官方/其它，不经本应用）。
fn has_claude_env() -> bool {
    std::fs::read_to_string(claude_settings_path())
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("env").cloned())
        .map(|env| env.get("ANTHROPIC_BASE_URL").is_some() || env.get("ANTHROPIC_AUTH_TOKEN").is_some())
        .unwrap_or(false)
}

/// 保存用户配置：写本应用 config.json + 应用到 `~/.claude/settings.json`。
/// `api_key` 传脱敏占位（含 `…` 或全 `•`）时表示「不改 key」，沿用已存的。
#[tauri::command]
pub fn set_config(config: ModelConfig) -> Result<ConfigStatus, String> {
    let mut cfg = config;
    // 脱敏占位 → 保留原 key
    if cfg.api_key.contains('…') || cfg.api_key.chars().all(|c| c == '•') {
        cfg.api_key = read_config().api_key;
    }

    std::fs::create_dir_all(crate::paths::app_home())
        .map_err(|e| format!("创建配置目录失败: {e}"))?;
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(config_path(), s).map_err(|e| format!("写入 config.json 失败: {e}"))?;

    apply_to_claude(&cfg)?;
    Ok(get_config())
}
