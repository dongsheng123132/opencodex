/**
 * 轻量 i18n 核心 —— 「英文即 key + 中文覆盖字典 + 缺失回退英文」。
 *
 * 与 U-King 的 i18n 方向相反：OpenCodex 是英文优先的开源项目，组件里保留英文原文，
 * 渲染时 `t("English text")` 包一层；中文放中央字典 `zh.ts`（`{英文: 中文}`）。
 * 未翻译的串自动回退英文 —— 永不空白/崩，可增量翻译。
 * 自研 ~50 行，不引 react-i18next（守体积红线）。
 * 默认跟随系统语言（zh* → 中文，其余 → 英文），localStorage 记住用户选择，跨会话保留。
 *
 * 用法：组件内 `const { t, lang, setLang } = useI18n();` 然后 `{t("New chat")}`。
 * 插值：`t("Imported {n} sessions", { n: 3 })` —— 占位符 `{name}` 由 vars 替换。
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ZH } from "./zh";

export type Lang = "zh" | "en";

const STORE_KEY = "opencodex.lang";

/** 读持久化的语言选择；没有则跟随系统（zh* → 中文）。 */
function detectDefault(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* localStorage 不可用时静默回退 */
  }
  try {
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

/** 把 `{name}` 占位符替换成 vars 里的值；vars 缺失则原样保留占位符。 */
function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** 翻译：中文态查 ZH 字典（缺失回退英文），英文态直接返回原文；支持 {name} 插值。 */
  t: (en: string, vars?: Record<string, string | number>) => string;
};

const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectDefault);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORE_KEY, l);
    } catch {
      /* ignore */
    }
    try {
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (en: string, vars?: Record<string, string | number>) => {
      const raw = lang === "zh" ? ZH[en] ?? en : en;
      return interpolate(raw, vars);
    },
    [lang],
  );

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n 必须在 <I18nProvider> 内使用");
  return ctx;
}
