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
    preset: "vscode-dark",
    colors: {
      ...DEFAULT_TERMINAL_PALETTE,
      background: "#1e1e1e", foreground: "#cccccc", cursor: "#ffffff", cursorAccent: "#1e1e1e",
      selectionBackground: "#264f78", black: "#000000", red: "#cd3131", green: "#0dbc79",
      yellow: "#e5e510", blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5",
      brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543",
      brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#ffffff",
    },
  },
  {
    preset: "windows-campbell",
    colors: {
      ...DEFAULT_TERMINAL_PALETTE,
      background: "#0c0c0c", foreground: "#cccccc", cursor: "#ffffff", cursorAccent: "#0c0c0c",
      selectionBackground: "#4d4d4d", black: "#0c0c0c", red: "#c50f1f", green: "#13a10e",
      yellow: "#c19c00", blue: "#0037da", magenta: "#881798", cyan: "#3a96dd", white: "#cccccc",
      brightBlack: "#767676", brightRed: "#e74856", brightGreen: "#16c60c", brightYellow: "#f9f1a5",
      brightBlue: "#3b78ff", brightMagenta: "#b4009e", brightCyan: "#61d6d6", brightWhite: "#f2f2f2",
    },
  },
  {
    preset: "github-light",
    colors: {
      ...DEFAULT_TERMINAL_PALETTE,
      background: "#ffffff", foreground: "#24292f", cursor: "#0969da", cursorAccent: "#ffffff",
      selectionBackground: "#b6d7ff", black: "#24292f", red: "#cf222e", green: "#1a7f37",
      yellow: "#9a6700", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#d0d7de",
      brightBlack: "#57606a", brightRed: "#ff8182", brightGreen: "#4ac26b", brightYellow: "#d4a72c",
      brightBlue: "#54aeff", brightMagenta: "#a475f9", brightCyan: "#39c5cf", brightWhite: "#f6f8fa",
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
    const knownPresets = new Set(["default", "vscode-dark", "windows-campbell", "github-light", "custom"]);
    return {
      preset: typeof parsed.preset === "string" && knownPresets.has(parsed.preset) ? parsed.preset : "custom",
      colors: { ...DEFAULT_TERMINAL_PALETTE, ...safeColors },
    };
  } catch {
    return { preset: "default", colors: { ...DEFAULT_TERMINAL_PALETTE } };
  }
}

export function previewTerminalTheme(setting: TerminalThemeSetting) {
  window.dispatchEvent(new CustomEvent<TerminalThemeSetting>(TERMINAL_THEME_EVENT, { detail: setting }));
}
