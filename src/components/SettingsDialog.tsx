/**
 * AI 设置中心。
 *
 * 先如实展示各 CLI 的安装状态和「沿用其自身配置」这一默认事实；只有用户主动打开
 * Claude Code 临时路由时，才把自带的模型环境传给 OpenCodex 的结构化对话子进程。
 * 不读取、不改写任何 CLI 的原配置，也不干预终端配色。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, CheckCircle2, Circle, Info, Save, X } from "lucide-react";
import { useI18n } from "../i18n";

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
  hermes_installed: boolean;
  gemini_installed: boolean;
  opencode_installed: boolean;
  ready: boolean;
};

const EMPTY_CONFIG: ModelConfig = { base_url: "", api_key: "", model: "", small_model: "" };

/** 常见端点预设（仅填充表单，不发送任何请求）。 */
const PRESETS: { name: string; base_url: string; model: string; small_model: string; hint: string }[] = [
  { name: "DeepSeek", base_url: "https://api.deepseek.com/anthropic", model: "deepseek-chat", small_model: "deepseek-chat", hint: "Get a key at platform.deepseek.com" },
  { name: "Zhipu GLM", base_url: "https://open.bigmodel.cn/api/anthropic", model: "glm-4.6", small_model: "glm-4-flash", hint: "Get a key at bigmodel.cn" },
  { name: "Kimi (Moonshot)", base_url: "https://api.moonshot.cn/anthropic", model: "kimi-k2-0905-preview", small_model: "moonshot-v1-8k", hint: "Get a key at platform.moonshot.cn" },
  { name: "Anthropic Official", base_url: "https://api.anthropic.com", model: "claude-sonnet-4-6", small_model: "claude-haiku-4-5-20251001", hint: "Get a key at console.anthropic.com" },
];

const CLI_STATUS: { name: string; field: keyof Pick<ConfigStatus, "claude_installed" | "codex_installed" | "hermes_installed" | "gemini_installed" | "opencode_installed"> }[] = [
  { name: "Claude Code", field: "claude_installed" },
  { name: "Codex", field: "codex_installed" },
  { name: "Hermes", field: "hermes_installed" },
  { name: "Gemini CLI", field: "gemini_installed" },
  { name: "OpenCode", field: "opencode_installed" },
];

export function SettingsDialog({ onToast, onClose, dataDir, portable }: { onToast: (s: string) => void; onClose: () => void; dataDir: string | null; portable: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [form, setForm] = useState<ModelConfig>(EMPTY_CONFIG);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<ConfigStatus>("get_config")
      .then((s) => {
        setStatus(s);
        setForm(s.config);
        setOverrideEnabled(s.ready);
      })
      .catch(() => {});
  }, []);

  const set = (k: keyof ModelConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setOverrideEnabled(true);
    setForm((f) => ({ ...f, base_url: p.base_url, model: p.model, small_model: p.small_model }));
  };

  const save = async () => {
    const next = overrideEnabled ? form : EMPTY_CONFIG;
    const hasModelConfig = Object.values(next).some((value) => value.trim());
    if (hasModelConfig && !next.base_url.trim()) return onToast(t("Please enter a Base URL"));
    setSaving(true);
    try {
      const s = await invoke<ConfigStatus>("set_config", { config: next });
      setStatus(s);
      setForm(s.config);
      setOverrideEnabled(s.ready);
      onToast(t("Settings saved"));
      onClose();
    } catch (e) {
      onToast(t("Save failed: {e}", { e: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-[620px] max-w-[92vw] max-h-[88vh] overflow-y-auto rounded-card border border-overlay/[0.10] bg-bg-2 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-overlay/[0.06]">
          <div className="flex items-center gap-2"><Bot size={17} className="text-accent" /><h2 className="text-[15px] font-semibold text-ink-0">{t("AI Setup Center")}</h2></div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-1" aria-label={t("Cancel")}><X size={18} /></button>
        </header>

        <div className="px-5 py-4 space-y-5">
          <section className="rounded-lg border border-overlay/[0.08] bg-overlay/[0.025] px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink-1"><Info size={14} className="text-accent shrink-0" />{t("Your CLI stays in charge")}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-4">{t("OpenCodex only detects these tools. Unless you explicitly enable the optional Claude Code route below, every CLI uses its own existing default configuration. OpenCodex never writes Claude, Codex, Hermes, Gemini, OpenCode, or system settings.")}</p>
          </section>

          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("Detected AI CLIs")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {status && CLI_STATUS.map(({ name, field }) => {
                const installed = status[field];
                return <div key={field} className="flex items-center gap-2.5 rounded-lg border border-overlay/[0.08] px-3 py-2.5">
                  {installed ? <CheckCircle2 size={15} className="text-success-400 shrink-0" /> : <Circle size={15} className="text-ink-5 shrink-0" />}
                  <div className="min-w-0"><div className="text-[12px] text-ink-1">{name}</div><div className="text-[10.5px] text-ink-5">{installed ? t("Detected · uses its own config") : t("Not installed")}</div></div>
                </div>;
              })}
              {!status && <div className="text-[11px] text-ink-5">{t("Checking installed CLIs…")}</div>}
            </div>
          </section>

          <section className="pt-4 border-t border-overlay/[0.06] space-y-3">
            <div><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("Optional Claude Code route")}</div><p className="mt-1 text-[11px] leading-relaxed text-ink-5">{t("Use this only when you want OpenCodex's structured Claude Code chat to use your own compatible endpoint. It is temporary for that chat process only; terminals and every other CLI remain untouched.")}</p></div>
            <label className="flex items-center gap-2.5 rounded-lg border border-overlay/[0.08] px-3 py-2.5 cursor-pointer hover:bg-overlay/[0.03]"><input type="checkbox" checked={overrideEnabled} onChange={(e) => setOverrideEnabled(e.target.checked)} className="accent-accent" /><span className="text-[12px] text-ink-1">{t("Enable a temporary route for OpenCodex Claude Code chat")}</span></label>
            {overrideEnabled && <div className="space-y-3">
              <div><div className="text-[12px] text-ink-3 mb-2">{t("Quick fill (fills the form only, sends no request)")}</div><div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.name} onClick={() => applyPreset(p)} title={t(p.hint)} className="px-2.5 h-7 rounded-md border border-overlay/[0.10] text-ink-2 text-[12px] hover:bg-overlay/[0.04] hover:text-ink-0">{p.name}</button>)}</div></div>
              <Field label={t("Base URL")} hint={t("Any Anthropic-compatible endpoint")}><input value={form.base_url} onChange={set("base_url")} placeholder="https://api.deepseek.com/anthropic" className="input" /></Field>
              <Field label={t("API Key")} hint={t("Stored locally in ~/.opencodex/config.json, never uploaded")}><input value={form.api_key} onChange={set("api_key")} placeholder="sk-..." className="input font-mono" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label={t("Main model")} hint="ANTHROPIC_MODEL"><input value={form.model} onChange={set("model")} placeholder="deepseek-chat" className="input" /></Field><Field label={t("Small / fast model")} hint={t("Optional")}><input value={form.small_model} onChange={set("small_model")} placeholder="deepseek-chat" className="input" /></Field></div>
            </div>}
          </section>

          <section className="pt-4 border-t border-overlay/[0.06] space-y-1"><div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-4"><Info size={12} /> {t("About")}</div><div className="text-[12px] text-ink-2">OpenCodex v{__APP_VERSION__}{portable ? ` · ${t("Portable data")}` : ""}</div>{dataDir && <div className="text-[11px] text-ink-4 font-mono break-all" title={dataDir}>{t("Data folder")}: {dataDir}</div>}</section>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-overlay/[0.06]"><button onClick={onClose} className="px-3.5 h-9 rounded-lg border border-overlay/[0.10] text-ink-2 text-[13px] hover:bg-overlay/[0.04]">{t("Cancel")}</button><button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent-600 disabled:opacity-60"><Save size={14} />{saving ? t("Saving…") : t("Save")}</button></footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="flex items-baseline gap-2 mb-1"><span className="text-[12px] font-medium text-ink-2">{label}</span>{hint && <span className="text-[10px] text-ink-5">{hint}</span>}</span>{children}</label>;
}
