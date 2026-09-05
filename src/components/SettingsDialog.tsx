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
import { ChevronDown, Download, Info, KeyRound, Monitor, Moon, Palette, RotateCcw, Save, Sun, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useTheme, type ThemePreference } from "../theme";
import {
  DEFAULT_TERMINAL_THEME_SETTING,
  parseTerminalTheme,
  previewTerminalTheme,
  TERMINAL_THEME_KV_KEY,
  TERMINAL_THEME_PRESETS,
  type TerminalPalette,
  type TerminalThemeSetting,
} from "../opencodex/term/terminalTheme";

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
    hint: "Get a key at platform.deepseek.com",
  },
  {
    name: "Zhipu GLM",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-4.6",
    small_model: "glm-4-flash",
    hint: "Get a key at bigmodel.cn",
  },
  {
    name: "Kimi (Moonshot)",
    base_url: "https://api.moonshot.cn/anthropic",
    model: "kimi-k2-0905-preview",
    small_model: "moonshot-v1-8k",
    hint: "Get a key at platform.moonshot.cn",
  },
  {
    name: "Anthropic Official",
    base_url: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    small_model: "claude-haiku-4-5-20251001",
    hint: "Get a key at console.anthropic.com",
  },
];

const BASIC_TERMINAL_COLORS: { key: keyof TerminalPalette; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "cursor", label: "Cursor" },
  { key: "selectionBackground", label: "Selection" },
];

const ANSI_COLOR_KEYS: (keyof TerminalPalette)[] = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

function copyTerminalTheme(setting: TerminalThemeSetting): TerminalThemeSetting {
  return { preset: setting.preset, colors: { ...setting.colors } };
}

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (x + 0.05) / (y + 0.05);
}

export function SettingsDialog({
  onToast,
  onClose,
  onTasksImported,
}: {
  onToast: (s: string) => void;
  onClose: () => void;
  onTasksImported: () => void;
}) {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [form, setForm] = useState<ModelConfig>({ base_url: "", api_key: "", model: "", small_model: "" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [terminalColorsOpen, setTerminalColorsOpen] = useState(false);
  const [showAnsiColors, setShowAnsiColors] = useState(false);
  const [terminalThemeLoaded, setTerminalThemeLoaded] = useState(false);
  const [terminalThemeSetting, setTerminalThemeSetting] = useState<TerminalThemeSetting>(() => copyTerminalTheme(DEFAULT_TERMINAL_THEME_SETTING));
  const [savedTerminalTheme, setSavedTerminalTheme] = useState<TerminalThemeSetting>(() => copyTerminalTheme(DEFAULT_TERMINAL_THEME_SETTING));

  useEffect(() => {
    invoke<ConfigStatus>("get_config")
      .then((s) => {
        setStatus(s);
        setForm(s.config);
      })
      .catch(() => {});
    invoke<string | null>("kv_get", { key: TERMINAL_THEME_KV_KEY })
      .then((value) => {
        const setting = parseTerminalTheme(value);
        setTerminalThemeSetting(copyTerminalTheme(setting));
        setSavedTerminalTheme(copyTerminalTheme(setting));
        setTerminalThemeLoaded(true);
      })
      .catch(() => setTerminalThemeLoaded(true));
  }, []);

  const set = (k: keyof ModelConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const applyPreset = (p: (typeof PRESETS)[number]) =>
    setForm((f) => ({ ...f, base_url: p.base_url, model: p.model, small_model: p.small_model }));

  const applyTerminalPreset = (setting: TerminalThemeSetting) => {
    const next = copyTerminalTheme(setting);
    setTerminalThemeSetting(next);
    previewTerminalTheme(next);
  };

  const setTerminalColor = (key: keyof TerminalPalette, value: string) => {
    setTerminalThemeSetting((current) => {
      const colors = { ...current.colors, [key]: value };
      // 光标文字底色默认跟随背景，避免改浅色后光标内字看不清。
      if (key === "background" && current.colors.cursorAccent === current.colors.background) colors.cursorAccent = value;
      const next = { preset: "custom", colors };
      previewTerminalTheme(next);
      return next;
    });
  };

  const cancel = () => {
    if (terminalThemeLoaded) previewTerminalTheme(savedTerminalTheme);
    onClose();
  };

  const save = async () => {
    if (!terminalThemeLoaded) return;
    const hasModelConfig = Object.values(form).some((value) => value.trim());
    if (hasModelConfig && !form.base_url.trim()) return onToast(t("Please enter a Base URL"));
    setSaving(true);
    try {
      const s = await invoke<ConfigStatus>("set_config", { config: form });
      await invoke("kv_set", {
        key: TERMINAL_THEME_KV_KEY,
        value: terminalThemeSetting.preset === "default" ? null : JSON.stringify(terminalThemeSetting),
      });
      setStatus(s);
      setForm(s.config);
      setSavedTerminalTheme(copyTerminalTheme(terminalThemeSetting));
      previewTerminalTheme(terminalThemeSetting);
      onToast(t("Settings saved"));
      onClose();
    } catch (e) {
      onToast(t("Save failed: {e}", { e: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const importFromUking = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const r = await invoke<{ imported: number; skipped: number; source_exists: boolean }>("import_uking_tasks");
      if (!r.source_exists) {
        onToast(t("No U-King workspace data found (~/.uking/tasks.json)"));
      } else if (r.imported > 0) {
        onToast(t("Imported {n} project session(s) from U-King ({s} already present)", { n: r.imported, s: r.skipped }));
        onTasksImported();
      } else {
        onToast(t("Nothing to import — all {n} U-King project(s) already here", { n: r.skipped }));
      }
    } catch (e) {
      onToast(t("Import failed: {e}", { e: String(e) }));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={cancel}>
      <div
        className="w-[560px] max-w-[92vw] max-h-[88vh] overflow-y-auto rounded-card border border-overlay/[0.10] bg-bg-2 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-overlay/[0.06]">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-ink-0">{t("Settings")}</h2>
          </div>
          <button onClick={cancel} className="text-ink-4 hover:text-ink-1">
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("Appearance")}</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "system", label: "System", icon: Monitor },
                { id: "light", label: "Light", icon: Sun },
                { id: "dark", label: "Dark", icon: Moon },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setPreference(id as ThemePreference)}
                  className={
                    "inline-flex items-center justify-center gap-1.5 h-8 rounded-md border text-[12px] transition-colors " +
                    (preference === id
                      ? "border-accent/60 bg-accent/[0.12] text-ink-0"
                      : "border-overlay/[0.10] text-ink-3 hover:bg-overlay/[0.04] hover:text-ink-1")
                  }
                >
                  <Icon size={13} /> {t(label)}
                </button>
              ))}
            </div>
          </section>

          <section className="pt-4 border-t border-overlay/[0.06] space-y-2">
            <button
              onClick={() => setTerminalColorsOpen((open) => !open)}
              disabled={!terminalThemeLoaded}
              className="w-full flex items-center justify-between text-left disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                <Palette size={12} /> {t("Terminal colors")}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-4">
                {t("Independent from app appearance")}
                <ChevronDown size={13} className={terminalColorsOpen ? "rotate-180 transition-transform" : "transition-transform"} />
              </span>
            </button>

            {terminalColorsOpen && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-4 gap-2">
                  {TERMINAL_THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.preset}
                      onClick={() => applyTerminalPreset(preset)}
                      className={
                        "h-8 rounded-md border text-[11px] transition-colors " +
                        (terminalThemeSetting.preset === preset.preset
                          ? "border-accent/60 bg-accent/[0.12] text-ink-0"
                          : "border-overlay/[0.10] text-ink-3 hover:bg-overlay/[0.04] hover:text-ink-1")
                      }
                    >
                      {t(preset.preset === "default" ? "Default" : preset.preset === "deep-gray" ? "Deep gray" : preset.preset === "high-contrast" ? "High contrast" : "Light terminal")}
                    </button>
                  ))}
                </div>

                <div
                  className="rounded-md border border-overlay/[0.10] px-3 py-2 font-mono text-[12px]"
                  style={{ color: terminalThemeSetting.colors.foreground, background: terminalThemeSetting.colors.background }}
                >
                  Aa 中文 0123&nbsp;
                  {["red", "green", "yellow", "blue", "magenta", "cyan"].map((key) => (
                    <span key={key} style={{ color: terminalThemeSetting.colors[key as keyof TerminalPalette] }}>■</span>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {BASIC_TERMINAL_COLORS.map(({ key, label }) => (
                    <ColorField key={key} label={t(label)} value={terminalThemeSetting.colors[key]} onChange={(value) => setTerminalColor(key, value)} />
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <button onClick={() => setShowAnsiColors((show) => !show)} className="text-[11px] text-ink-3 hover:text-ink-0">
                    {showAnsiColors ? t("Hide ANSI 16 colors") : t("Edit ANSI 16 colors")}
                  </button>
                  <span className={"text-[10px] " + (contrastRatio(terminalThemeSetting.colors.background, terminalThemeSetting.colors.foreground) < 4.5 ? "text-amber-500" : "text-ink-5")}>
                    {t("Text contrast")} {contrastRatio(terminalThemeSetting.colors.background, terminalThemeSetting.colors.foreground).toFixed(1)}:1
                  </span>
                </div>

                {showAnsiColors && (
                  <div className="grid grid-cols-8 gap-1.5">
                    {ANSI_COLOR_KEYS.map((key) => (
                      <label key={key} className="group relative h-7 rounded border border-overlay/[0.10] overflow-hidden cursor-pointer" title={key}>
                        <span className="absolute inset-0" style={{ background: terminalThemeSetting.colors[key] }} />
                        <input type="color" value={terminalThemeSetting.colors[key]} onChange={(e) => setTerminalColor(key, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                      </label>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => applyTerminalPreset(DEFAULT_TERMINAL_THEME_SETTING)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-ink-4 hover:text-ink-1"
                >
                  <RotateCcw size={11} /> {t("Restore terminal defaults")}
                </button>
                <div className="text-[10.5px] leading-relaxed text-ink-5">
                  {t("Only changes xterm colors inside this app. It never edits Claude, Codex, Hermes, or system terminal settings.")}
                </div>
              </div>
            )}
          </section>

          <div className="pt-4 border-t border-overlay/[0.06] text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("AI model")}</div>
          {status && !status.claude_installed && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5 text-[12px] text-ink-1 leading-relaxed">
              ⚠ The <b>claude</b> command was not found. Sessions require the Claude Code CLI:
              <code className="mx-1 px-1 rounded bg-overlay/[0.08] font-mono">npm i -g @anthropic-ai/claude-code</code>
              (you can run this right in the terminal panel).
            </div>
          )}

          <div>
            <div className="text-[12px] text-ink-3 mb-2">{t("Quick fill (fills the form only, sends no request)")}</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  title={t(p.hint)}
                  className="px-2.5 h-7 rounded-md border border-overlay/[0.10] text-ink-2 text-[12px] hover:bg-overlay/[0.04] hover:text-ink-0"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <Field label={t("Base URL")} hint={t("Any Anthropic-compatible endpoint")}>
            <input
              value={form.base_url}
              onChange={set("base_url")}
              placeholder="https://api.deepseek.com/anthropic"
              className="input"
            />
          </Field>

          <Field label={t("API Key")} hint={t("Stored locally in ~/.opencodex/config.json, never uploaded")}>
            <input
              value={form.api_key}
              onChange={set("api_key")}
              placeholder="sk-..."
              className="input font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Main model")} hint="ANTHROPIC_MODEL">
              <input value={form.model} onChange={set("model")} placeholder="deepseek-chat" className="input" />
            </Field>
            <Field label={t("Small / fast model")} hint={t("Optional")}>
              <input value={form.small_model} onChange={set("small_model")} placeholder="deepseek-chat" className="input" />
            </Field>
          </div>

          <div className="text-[11px] text-ink-4 leading-relaxed">
            {t("Saved only to ~/.opencodex/config.json, and applied only to terminals and AI subprocesses launched by OpenCodex.")}
          </div>

          <section className="pt-4 border-t border-overlay/[0.06] space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("Data & migration")}</div>
            <button
              onClick={() => void importFromUking()}
              disabled={importing}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-overlay/[0.10] text-ink-2 text-[12px] hover:bg-overlay/[0.04] hover:text-ink-0 disabled:opacity-40"
            >
              <Download size={13} />
              {importing ? t("Importing…") : t("Import U-King")}
            </button>
            <div className="text-[11px] text-ink-4">{t("Import projects & sessions from U-King workspace (~/.uking/tasks.json)")}</div>
          </section>

          <section className="pt-4 border-t border-overlay/[0.06] space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              <Info size={12} /> {t("About")}
            </div>
            <div className="text-[12px] text-ink-2">OpenCodex v{__APP_VERSION__}</div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-4 border-t border-overlay/[0.06]">
          <button onClick={cancel} className="px-3.5 h-9 rounded-lg border border-overlay/[0.10] text-ink-2 text-[13px] hover:bg-overlay/[0.04]">
            {t("Cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving || !terminalThemeLoaded}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-600 disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? t("Saving…") : t("Save")}
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 min-w-0">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-7 shrink-0 rounded border border-overlay/[0.10] bg-transparent cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-[11px] text-ink-2">{label}</span>
        <span className="block font-mono text-[9px] text-ink-5 uppercase">{value}</span>
      </span>
    </label>
  );
}
