/**
 * 浏览器面板 —— 在独立 webview 子窗口打开 localhost / 网页。
 *
 * 为什么不内嵌 iframe：localhost 开发服务器和很多文档站带 X-Frame-Options: DENY，iframe 会白屏。
 * webview 子窗口不受此限。每个任务一个子窗口 label（browser-<taskId>），复用则导航。
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Globe } from "lucide-react";

const QUICK = [
  { label: "localhost:3000", url: "http://localhost:3000" },
  { label: "localhost:5173", url: "http://localhost:5173" },
  { label: "localhost:8080", url: "http://localhost:8080" },
];

export function BrowserPanel({ taskId }: { taskId: string }) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [err, setErr] = useState<string | null>(null);

  const open = async (target: string) => {
    let u = target.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = "http://" + u;
    setErr(null);
    try {
      await invoke("open_browser", { url: u, label: `browser-${taskId}` });
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 h-10 px-3 border-b border-white/[0.06] shrink-0">
        <Globe size={14} className="text-ink-3 shrink-0" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && open(url)}
          placeholder="http://localhost:3000 或 https://…"
          className="flex-1 h-7 rounded-md border border-white/[0.10] bg-bg-1 px-2.5 text-[12.5px] text-ink-1 placeholder:text-ink-4 outline-none focus:border-accent/50"
        />
        <button
          onClick={() => open(url)}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-accent hover:bg-accent-600 text-white text-[12px] shrink-0"
        >
          打开 <ArrowUpRight size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-ink-3 text-[13px]">在独立窗口打开预览页（localhost 也能开）</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {QUICK.map((q) => (
            <button
              key={q.url}
              onClick={() => open(q.url)}
              className="h-8 px-3 rounded-full border border-white/[0.10] text-[12px] text-ink-2 hover:bg-white/[0.04] font-mono"
            >
              {q.label}
            </button>
          ))}
        </div>
        {err && <div className="text-danger-400 text-[12px]">{err}</div>}
      </div>
    </div>
  );
}
