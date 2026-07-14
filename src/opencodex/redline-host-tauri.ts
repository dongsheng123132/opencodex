/**
 * Redline 的 Tauri 宿主实现 —— opencodex 是 redline-core 的第一个宿主。
 * 全部复用现成能力，没有新增 Rust 依赖：
 *   readFileBytes → asset 协议（scope 已是 ["**"]，见 tauri.conf.json）
 *   annotationStore → kv.rs（现成的 kv_get/kv_set，本来就是给终端分屏布局存的那套）
 *   sendToAgent → SplitContainer 的 pasteToLast（复用 useTermGroup 的 pasteToActive，
 *                 写入文本不回车，跟拖文件路径进命令行走的是同一条已验证过的安全路径）
 *   openExternal → fs.rs 的 open_path（系统默认程序打开）
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { RedlineHost } from "redline-core";

/** pasteToTerminal 由 SplitArea 传下来，最终落到 SplitContainer 的 pasteToLast。 */
export function createTauriRedlineHost(pasteToTerminal: (text: string) => void): RedlineHost {
  return {
    async readFileBytes(path: string): Promise<ArrayBuffer> {
      const res = await fetch(convertFileSrc(path));
      if (!res.ok) throw new Error(`读取文件失败: HTTP ${res.status}`);
      return res.arrayBuffer();
    },
    getSrcUrl(path: string): string {
      return convertFileSrc(path);
    },
    annotationStore: {
      async get(key: string): Promise<string | null> {
        return invoke<string | null>("kv_get", { key });
      },
      async set(key: string, value: string | null): Promise<void> {
        await invoke("kv_set", { key, value });
      },
    },
    async sendToAgent(text: string): Promise<void> {
      pasteToTerminal(text);
    },
    async openExternal(path: string): Promise<void> {
      await invoke("open_path", { path });
    },
  };
}
