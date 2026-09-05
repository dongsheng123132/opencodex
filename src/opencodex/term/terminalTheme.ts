import type { ITheme } from "@xterm/xterm";

export const TERMINAL_THEME_KV_KEY = "terminal_theme";
export const TERMINAL_THEME_EVENT = "opencodex:terminal-theme";

export type TerminalPalette = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

export type TerminalThemeSetting = { preset: string; colors: TerminalPalette };

// 和原有固定 TERM_THEME + xterm 5.5 默认 ANSI 色保持一致。
// 只有用户显式调整「终端配色」才会改，不跟随应用外壳主题。
export const DEFAULT_TERMINAL_PALETTE: TerminalPalette = {
  background: "#0d0d0f",
  foreground: "#f7f8f8",
  cursor: "#5e6ad2",
  cursorAccent: "#0d0d0f",
  selectionBackground: "#252527",
  black: "#1b1b1f",
  red: "#cc0000",
  green: "#4e9a06",
  yellow: "#c4a000",
  blue: "#3465a4",
  magenta: "#75507b",
  cyan: "#06989a",
  white: "#e3e4e6",
  brightBlack: "#6b7280",
  brightRed: "#ef2929",
  brightGreen: "#8ae234",
  brightYellow: "#fce94f",
  brightBlue: "#729fcf",
  brightMagenta: "#ad7fa8",
  brightCyan: "#34e2e2",
  brightWhite: "#f7f8f8",
};

export const TERMINAL_THEME_PRESETS: TerminalThemeSetting[] = [
  { preset: "default", colors: DEFAULT_TERMINAL_PALETTE },
  {
    preset: "deep-gray",
    colors: {
      ...DEFAULT_TERMINAL_PALETTE,
      background: "#111318", foreground: "#d9dde7", cursor: "#7aa2f7", cursorAccent: "#111318",
      selectionBackground: "#2d3445", black: "#20242d", brightBlack: "#697386",
      blue: "#7aa2f7", cyan: "#7dcfff", green: "#9ece6a", magenta: "#bb9af7", red: "#f7768e", yellow: "#e0af68",
    },
  },
  {
    preset: "high-contrast",
    colors: {
      ...DEFAULT_TERMINAL_PALETTE,
      background: "#000000", foreground: "#ffffff", cursor: "#ffff00", cursorAccent: "#000000",
      selectionBackground: "#374151", black: "#000000", red: "#ff5f56", green: "#5af78e",
      yellow: "#f3f99d", blue: "#57c7ff", magenta: "#ff6ac1", cyan: "#9aedfe", white: "#f1f1f0",
      brightBlack: "#686868", brightRed: "#ff5f56", brightGreen: "#5af78e", brightYellow: "#f3f99d",
      brightBlue: "#57c7ff", brightMagenta: "#ff6ac1", brightCyan: "#9aedfe", brightWhite: "#ffffff",
    },
  },
  {
    preset: "light",
    colors: {
      ...DEFAULT_TERMINAL_PALETTE,
      background: "#f8f8f8", foreground: "#242424", cursor: "#3b5bdb", cursorAccent: "#f8f8f8",
      selectionBackground: "#cbd5e1", black: "#242424", red: "#c01c28", green: "#197b2d",
      yellow: "#7a6500", blue: "#2456a6", magenta: "#8b3f96", cyan: "#087d82", white: "#d4d4d4",
      brightBlack: "#666666", brightRed: "#e01b24", brightGreen: "#26a269", brightYellow: "#a27300",
      brightBlue: "#3584e4", brightMagenta: "#c061cb", brightCyan: "#0aa0a8", brightWhite: "#ffffff",
    },
  },
];

export const DEFAULT_TERMINAL_THEME_SETTING: TerminalThemeSetting = {
  preset: "default",
  colors: { ...DEFAULT_TERMINAL_PALETTE },
};

export function terminalTheme(setting: TerminalThemeSetting): ITheme {
  return { ...setting.colors };
}

export function parseTerminalTheme(value: string | null): TerminalThemeSetting {
  if (!value) return { preset: "default", colors: { ...DEFAULT_TERMINAL_PALETTE } };
  try {
    const parsed = JSON.parse(value) as Partial<TerminalThemeSetting>;
    const incoming = parsed.colors ?? {};
    const safeColors = Object.fromEntries(
      Object.entries(incoming).filter(([, color]) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)),
    ) as Partial<TerminalPalette>;
    return {
      preset: typeof parsed.preset === "string" ? parsed.preset : "custom",
      colors: { ...DEFAULT_TERMINAL_PALETTE, ...safeColors },
    };
  } catch {
    return { preset: "default", colors: { ...DEFAULT_TERMINAL_PALETTE } };
  }
}

export function previewTerminalTheme(setting: TerminalThemeSetting) {
  window.dispatchEvent(new CustomEvent<TerminalThemeSetting>(TERMINAL_THEME_EVENT, { detail: setting }));
}
