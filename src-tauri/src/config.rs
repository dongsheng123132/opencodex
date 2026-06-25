//! 自带模型配置（Bring Your Own Model）—— 纯本地，不连任何服务器。
//!
//! OpenCodex 不内置任何 API Key、不指向任何中转站。用户在「设置」里填自己的：
//!   - Base URL（任何 OpenAI / Anthropic 兼容端点，如 DeepSeek、本地 ollama、自建中转）
//!   - API Key
//!   - 模型名 / 小模型名
//!
//! 只写 `~/.opencodex/config.json`，不改 Claude Code 或系统全局配置。
//! OpenCodex 启动终端 / AI 子进程时再把这些值作为 env 临时注入。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::tool_installed;

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
    /// 是否已配好 OpenCodex 自己的模型环境（不读取 Claude Code 全局配置）
    pub ready: bool,
}

fn config_path() -> PathBuf {
    crate::paths::app_home().join("config.json")
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

pub fn apply_model_env_to_command(cmd: &mut std::process::Command) {
    let cfg = read_config();
    let mut put = |key: &str, value: &str| {
        let value = value.trim();
        if !value.is_empty() {
            cmd.env(key, value);
        }
    };
    put("ANTHROPIC_BASE_URL", &cfg.base_url);
    put("ANTHROPIC_AUTH_TOKEN", &cfg.api_key);
    put("ANTHROPIC_MODEL", &cfg.model);
    put("ANTHROPIC_SMALL_FAST_MODEL", &cfg.small_model);
}

pub fn apply_model_env_to_pty(builder: &mut portable_pty::CommandBuilder) {
    let cfg = read_config();
    let mut put = |key: &str, value: &str| {
        let value = value.trim();
        if !value.is_empty() {
            builder.env(key, value);
        }
    };
    put("ANTHROPIC_BASE_URL", &cfg.base_url);
    put("ANTHROPIC_AUTH_TOKEN", &cfg.api_key);
    put("ANTHROPIC_MODEL", &cfg.model);
    put("ANTHROPIC_SMALL_FAST_MODEL", &cfg.small_model);
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
        // 只代表 OpenCodex 自己保存的模型环境是否完整；不读取/推断 Claude Code 全局配置。
        ready: configured,
    }
}

/// 保存用户配置：只写本应用 config.json，不改 Claude Code 或系统全局配置。
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

    Ok(get_config())
}
