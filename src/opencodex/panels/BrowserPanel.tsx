/**
 * 浏览器面板 —— 在右侧内嵌 iframe 打开 localhost / 网页；被拒内嵌的站点弹独立窗口兜底。
 *
 * 默认内嵌（iframe）：localhost 开发服务器、本地 HTML 直接在右侧显示，不用切窗口。
 * 兜底（独立子窗口）：少数站点带 X-Frame-Options: DENY，iframe 会白屏 —— 这时点「新窗口」
 * 用 open_browser 弹独立 webview 子窗口（不受 X-Frame-Options 限制）。
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Globe, RefreshCw, ExternalLink } from "lucide-react";

const QUICK = [
  { label: "localhost:3000", url: "http://localhost:3000" },
  { label: "localhost:5173", url: "http://localhost:5173" },
  { label: "localhost:8080", url: "http://localhost:8080" },
];

const normalize = (raw: string) => {
  const u = raw.trim();
  if (!u) return "";
  return /^https?:\/\//.test(u) ? u : "http://" + u;
};

export function BrowserPanel({ taskId }: { taskId: string }) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // 刷新 iframe 用
  const [err, setErr] = useState<string | null>(null);

  // 内嵌打开
  const openInline = (target: string) => {
    const u = normalize(target);
    if (!u) return;
    setErr(null);
    setUrl(u);
    setLoaded(u);
    setNonce((n) => n + 1);
  };

  // 兜底：弹独立窗口
  const openWindow = async (target: string) => {
    const u = normalize(target || loaded || "");
    if (!u) return;
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
          onKeyDown={(e) => e.key === "Enter" && openInline(url)}
          placeholder="http://localhost:3000 or https://…"
          className="flex-1 h-7 rounded-md border border-white/[0.10] bg-bg-1 px-2.5 text-[12.5px] text-ink-1 placeholder:text-ink-4 outline-none focus:border-accent/50"
        />
        {loaded && (
          <button
            onClick={() => setNonce((n) => n + 1)}
            title="Refresh"
            className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06] shrink-0"
          >
            <RefreshCw size={13} />
          </button>
        )}
        <button
          onClick={() => openInline(url)}
          className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-accent hover:bg-accent-600 text-white text-[12px] shrink-0"
        >
          Open <ArrowUpRight size={13} />
        </button>
        <button
          onClick={() => void openWindow(url)}
          title="Open in a separate window (for pages that block embedding)"
          className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06] shrink-0 border-l border-white/[0.08] ml-0.5 pl-1"
        >
          <ExternalLink size={13} />
        </button>
      </div>

      {loaded ? (
        <iframe
          key={nonce}
          src={loaded}
          title="Preview"
          className="flex-1 w-full bg-white border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-ink-3 text-[13px]">Open a preview page embedded on the right (localhost works too)</div>
          <div className="flex flex-wrap gap-2 justify-center">
            {QUICK.map((q) => (
              <button
                key={q.url}
                onClick={() => openInline(q.url)}
                className="h-8 px-3 rounded-full border border-white/[0.10] text-[12px] text-ink-2 hover:bg-white/[0.04] font-mono"
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="text-ink-5 text-[11px]">If the page is blank (embedding blocked), click ⬈ on the right of the address bar to open it in a separate window</div>
        </div>
      )}
      {err && <div className="shrink-0 px-3 py-1.5 text-danger-400 text-[12px] border-t border-white/[0.06]">{err}</div>}
    </div>
  );
}
