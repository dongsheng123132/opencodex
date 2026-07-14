/**
 * 本地 bug 收集（前端钩子）—— 捕获未处理错误，转发给 Rust 落盘
 * `~/.opencodex/logs/opencodex.jsonl`。纯本地、无上报、无服务器。
 *
 * 捕获：
 *  · window.onerror            —— 同步抛出的未捕获错误
 *  · unhandledrejection        —— 未 catch 的 Promise 拒绝（大量 invoke 失败走这）
 *  · console.error             —— 开发期很多错误只 console.error 没抛，也收进来
 *
 * 另导出 logBug()，给关键 catch 块手动记一条（如 invoke 失败点）。
 *
 * ## 可插拔
 * 删本文件 + main.tsx 里的 import/调用 即可移除，不动其他模块。
 */
import { invoke } from "@tauri-apps/api/core";

type Level = "error" | "warn" | "panic";

let installed = false;

/** 截断超长字符串，避免巨型堆栈把日志撑爆。 */
function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…[truncated]" : s;
}

/** 落一条日志（失败静默 —— 收集本身绝不能反过来报错/循环）。 */
function send(level: Level, source: string, msg: string, detail = "") {
  invoke("app_log", {
    rec: {
      ts: new Date().toLocaleString(),
      level,
      source,
      msg: cut(msg, 2000),
      detail: cut(detail, 8000),
    },
  }).catch(() => {});
}

/** 手动记一条 —— 在关键 catch 块用：`logBug("invoke:term_open", e)`。 */
export function logBug(source: string, err: unknown) {
  const e = err as { message?: string; stack?: string } | undefined;
  send("error", source, e?.message ?? String(err), e?.stack ?? "");
}

/** 安装全局错误钩子（幂等，重复调用无副作用）。在 main.tsx render 前调一次。 */
export function installBugTrap() {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (ev) => {
    const e = ev.error as { message?: string; stack?: string } | undefined;
    send(
      "error",
      "window.onerror",
      e?.message ?? ev.message ?? "unknown error",
      e?.stack ?? `${ev.filename}:${ev.lineno}:${ev.colno}`,
    );
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason as { message?: string; stack?: string } | undefined;
    send("error", "unhandledrejection", r?.message ?? String(ev.reason), r?.stack ?? "");
  });

  // 包一层 console.error：转发后仍调原函数（开发面板照常能看）。
  // send 内部用 .catch 吞掉失败，不会再触发 console.error → 无递归。
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const msg = args
        .map((a) => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");
      send("error", "console.error", msg);
    } catch {
      /* 收集本身别报错 */
    }
    orig(...args);
  };
}
