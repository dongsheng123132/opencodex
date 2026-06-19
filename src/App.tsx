/**
 * OpenCodex —— 开源、绿色的本地编程工作台。
 *
 * 整屏只装一个 OpenCodex 工作台：左会话列表 + 全宽对话（顶栏可滑出终端/文件/浏览器）。
 * 右上角一个「设置」入口，配自己的模型（Base URL / API Key / 模型名）—— 完全本地，无服务器。
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, Sparkles } from "lucide-react";
import { OpenCodex } from "./opencodex/OpenCodex";
import { SettingsDialog } from "./components/SettingsDialog";

type AppEnv = {
  platform: string;
  home_dir: string;
  opened_dir: string | null;
};

export function App() {
  const [env, setEnv] = useState<AppEnv | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    invoke<AppEnv>("get_env").then(setEnv).catch(() => setEnv(null));
  }, []);

  return (
    <div className="h-full flex flex-col">
      <TitleBar onSettings={() => setShowSettings(true)} />

      <main className="flex-1 min-w-0 min-h-0 p-3">
        <OpenCodex
          openedDir={env?.opened_dir ?? null}
          homeDir={env?.home_dir ?? null}
          onToast={flash}
          onGoManage={() => setShowSettings(true)}
        />
      </main>

      {showSettings && (
        <SettingsDialog onToast={flash} onClose={() => setShowSettings(false)} />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-2 rounded-full border border-white/[0.10] bg-bg-3/95 backdrop-blur px-4 py-2 text-[13px] text-ink-1 shadow-card">
            <Sparkles size={14} className="text-accent" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 自定义标题栏 ---------------- */

function TitleBar({ onSettings }: { onSettings: () => void }) {
  return (
    <header
      data-tauri-drag-region
      className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-white/[0.06] bg-bg-0"
    >
      <div className="flex items-center gap-2 pointer-events-none select-none">
        <span className="grid place-items-center w-5 h-5 rounded bg-accent text-white">
          <Sparkles size={12} />
        </span>
        <span className="text-[12px] font-semibold text-ink-1 tracking-wide">OpenCodex</span>
      </div>
      <button
        onClick={onSettings}
        title="模型设置"
        className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 h-6 rounded text-ink-3 text-[11px] hover:bg-white/[0.04] hover:text-ink-1 transition-colors"
      >
        <Settings size={13} />
        模型设置
      </button>
    </header>
  );
}
