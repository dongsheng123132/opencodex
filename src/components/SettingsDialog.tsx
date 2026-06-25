/**
 * 模型设置弹层 —— 自带模型（Bring Your Own Model）。
 *
 * 用户填自己的 Base URL / API Key / 模型名，只保存到 ~/.opencodex/config.json。
 * OpenCodex 启动的终端与 AI 子进程会临时注入这些 env；不改 Claude Code 全局配置。
 *
 * 兼容任何 Anthropic 风格端点：官方、DeepSeek 的 /anthropic 网关、自建中转、本地代理等。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, KeyRound } from "lucide-react";

type ModelConfig = {
  base_url: string;
  api_key: string;
  model: string;
  small_model: string;
};

type ConfigStatus = {
  config: ModelConfig;
  claude_installed: boolean;
  codex_installed: boolean;
  ready: boolean;
};

/** 常见端点预设（仅填充表单，不发送任何请求）。 */
const PRESETS: { name: string; base_url: string; model: string; small_model: string; hint: string }[] = [
  {
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/anthropic",
    model: "deepseek-chat",
    small_model: "deepseek-chat",
    hint: "platform.deepseek.com 申请 Key",
  },
  {
    name: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-4.6",
    small_model: "glm-4-flash",
    hint: "bigmodel.cn 申请 Key",
  },
  {
    name: "Kimi (Moonshot)",
    base_url: "https://api.moonshot.cn/anthropic",
    model: "kimi-k2-0905-preview",
    small_model: "moonshot-v1-8k",
    hint: "platform.moonshot.cn 申请 Key",
  },
  {
    name: "Anthropic 官方",
    base_url: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    small_model: "claude-haiku-4-5-20251001",
    hint: "console.anthropic.com 申请 Key",
  },
];

export function SettingsDialog({
  onToast,
  onClose,
}: {
  onToast: (s: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [form, setForm] = useState<ModelConfig>({ base_url: "", api_key: "", model: "", small_model: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<ConfigStatus>("get_config")
      .then((s) => {
        setStatus(s);
        setForm(s.config);
      })
      .catch(() => {});
  }, []);

  const set = (k: keyof ModelConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const applyPreset = (p: (typeof PRESETS)[number]) =>
    setForm((f) => ({ ...f, base_url: p.base_url, model: p.model, small_model: p.small_model }));

  const save = async () => {
    if (!form.base_url.trim()) return onToast("请填写 Base URL");
    setSaving(true);
    try {
      const s = await invoke<ConfigStatus>("set_config", { config: form });
      setStatus(s);
      setForm(s.config);
      onToast("已保存，对话将使用你的模型");
      onClose();
    } catch (e) {
      onToast("保存失败：" + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-[560px] max-w-[92vw] max-h-[88vh] overflow-y-auto rounded-card border border-white/[0.10] bg-bg-2 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-ink-0">模型设置 · 自带模型</h2>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-1">
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {status && !status.claude_installed && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5 text-[12px] text-ink-1 leading-relaxed">
              ⚠ 未检测到 <b>claude</b> 命令。对话功能需要先装 Claude Code CLI：
              <code className="mx-1 px-1 rounded bg-black/30 font-mono">npm i -g @anthropic-ai/claude-code</code>
              （终端面板里可直接运行）。
            </div>
          )}

          <div>
            <div className="text-[12px] text-ink-3 mb-2">快速填充（仅填表单，不发请求）</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  title={p.hint}
                  className="px-2.5 h-7 rounded-md border border-white/[0.10] text-ink-2 text-[12px] hover:bg-white/[0.04] hover:text-ink-0"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <Field label="Base URL" hint="任何 Anthropic 兼容端点">
            <input
              value={form.base_url}
              onChange={set("base_url")}
              placeholder="https://api.deepseek.com/anthropic"
              className="input"
            />
          </Field>

          <Field label="API Key" hint="只存本地 ~/.opencodex/config.json，不上传">
            <input
              value={form.api_key}
              onChange={set("api_key")}
              placeholder="sk-..."
              className="input font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="主模型" hint="ANTHROPIC_MODEL">
              <input value={form.model} onChange={set("model")} placeholder="deepseek-chat" className="input" />
            </Field>
            <Field label="小/快模型" hint="可选">
              <input value={form.small_model} onChange={set("small_model")} placeholder="deepseek-chat" className="input" />
            </Field>
          </div>

          <div className="text-[11px] text-ink-4 leading-relaxed">
            仅保存到 <code className="font-mono">~/.opencodex/config.json</code>，只对 OpenCodex 启动的终端与 AI 子进程临时生效。
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-3.5 h-9 rounded-lg border border-white/[0.10] text-ink-2 text-[13px] hover:bg-white/[0.04]">
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-600 disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[12px] font-medium text-ink-1">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
