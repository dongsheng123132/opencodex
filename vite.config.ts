import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Tauri 期望固定端口；用相对 base 让打包后的 dist 能在 tauri://localhost 下直接加载。
export default defineConfig(async () => ({
  plugins: [react()],
  base: "./",
  // 版本号注入前端（顶栏/侧栏显示用），与 package.json 单一真相源同步
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
