/** @type {import('tailwindcss').Config} */
// 中性灰 + 单一冷调色（Linear / cc-switch 风）。去掉黑金御印，主流商务风。
export default {
  // redline-core 是独立仓库(../redline)、link: 依赖过来的，源码不在本仓库 src/ 下，
  // 得单独把它的 content 扫进来，否则里面用到的 Tailwind class 不会被 JIT 生成对应 CSS
  // （样式会"丢"，不是逻辑 bug）。
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../redline/packages/redline-core/src/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // 窄值域中性面：canvas=bg-0 → 抬升=bg-4
        bg: {
          0: "rgb(var(--bg-0) / <alpha-value>)",
          1: "rgb(var(--bg-1) / <alpha-value>)",
          2: "rgb(var(--bg-2) / <alpha-value>)",
          3: "rgb(var(--bg-3) / <alpha-value>)",
          4: "rgb(var(--bg-4) / <alpha-value>)",
        },
        ink: {
          0: "rgb(var(--ink-0) / <alpha-value>)",
          1: "rgb(var(--ink-1) / <alpha-value>)",
          2: "rgb(var(--ink-2) / <alpha-value>)",
          3: "rgb(var(--ink-3) / <alpha-value>)",
          4: "rgb(var(--ink-4) / <alpha-value>)",
          5: "rgb(var(--ink-5) / <alpha-value>)",
          6: "rgb(var(--ink-6) / <alpha-value>)",
        },
        overlay: "rgb(var(--overlay) / <alpha-value>)",
        // 单一冷调色（Linear 靛蓝），仅用于选中 / 焦点 / 主按钮
        accent: {
          DEFAULT: "#5e6ad2", 400: "#7a85e0", 500: "#5e6ad2",
          600: "#4f5ac0", 700: "#434ea8",
        },
        danger: { 400: "#f07a7a", 500: "#eb5757", 600: "#d94343" },
        success: { 400: "#46c46a", 500: "#27a644", 600: "#1f8f39" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.4)",
        pop: "0 8px 24px -8px rgba(0,0,0,0.6)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0, transform: "translateY(4px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.16s ease-out both",
      },
      borderRadius: { card: "6px", pill: "2px" },
    },
  },
  plugins: [],
};
