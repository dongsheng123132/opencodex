/** @type {import('tailwindcss').Config} */
// 中性灰 + 单一冷调色（Linear / cc-switch 风）。去掉黑金御印，主流商务风。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // 窄值域中性面：canvas=bg-0 → 抬升=bg-4
        bg: { 0: "#0d0d0f", 1: "#111114", 2: "#151518", 3: "#1b1b1f", 4: "#222227" },
        ink: {
          0: "#f7f8f8", 1: "#e3e4e6", 2: "#a1a1aa",
          3: "#8a8f98", 4: "#6b7280", 5: "#4a4d55", 6: "#2c2e33",
        },
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
