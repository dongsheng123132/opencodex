/**
 * 任务终端面板 —— 在任务文件夹（cwd）里开终端，跑 claude / codex / openclaw / hermes 等。
 *
 * 复用 useTermGroup 引擎。每个任务一个 TermPanel 实例 = 一个独立终端 group。
 * PTY 保活：切任务时父级用 display:none 隐藏，本组件不卸载 → PTY 续跑；
 * 只有「关闭任务」父级才卸载本组件，useTermGroup 的卸载 effect 关掉本任务所有 PTY。
 */
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTermGroup } from "../term/useTermGroup";
import "@xterm/xterm/css/xterm.css";

/** 把拖入的路径列表拼成命令行片段：含空格/特殊字符的路径加双引号，多个空格分隔，末尾留一个空格。 */
function pathsToCmdText(paths: string[]): string {
  const quote = (p: string) => (/[\s"'`$&|;()<>]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);
  return paths.map(quote).join(" ") + " ";
}

type QuickCmd = { label: string; cmd: string };

/** TermPanel 暴露给父级的命令式接口（透出 runInActive 给一键启动场景）。 */
export type TermPanelApi = { runCmd: (cmd: string) => void };

/** 终端顶部一键启动的常用命令（命令过后端白名单）。点一下发进终端执行。 */
const QUICK_TOOLS: { label: string; cmd: string }[] = [
  { label: "claude", cmd: "claude" },
  { label: "codex", cmd: "codex" },
  { label: "/model", cmd: "/model" }, // 切模型，最常用
  { label: "ccd", cmd: "ccd" }, // 常用命令
  { label: "openclaw gw", cmd: "openclaw gateway run" }, // 起 gateway 服务
  { label: "openclaw cli", cmd: "openclaw" }, // 连已起的 gateway，交互调能力
  { label: "hermes", cmd: "hermes" },
];

export function TermPanel({
  cwd,
  active,
  tool,
  initialCmd,
  prompts,
  onReady,
}: {
  cwd: string;
  active: boolean;
  tool?: string;
  initialCmd?: string;
  /** 顶栏快捷命令按钮（不传用默认 QUICK_TOOLS）。点了 runInActive 在当前终端跑。 */
  prompts?: { label: string; cmd: string }[];
  /** 挂载后回调，透出 runCmd 给父级（一键启动 WebUI 等场景）。 */
  onReady?: (api: TermPanelApi) => void;
}) {
  const { hostRef, tabs, activeKey, setActiveKey, newTerm, closeTerm, runInActive, pasteToActive, fontSize, bumpFontSize } = useTermGroup({
    open: active,
    cwd,
    tool,
    initialCmd,
  });

  // 拖放落路径：拖文件/图片/文件夹到本终端区 → 把真实路径写进当前命令行（不自动回车）。
  // 走 Tauri 窗口级 onDragDropEvent（webview 拦了 HTML5 drag，但能给真实文件系统路径）。
  // 多终端时按落点屏幕坐标判断命中哪个宿主，只往被拖到的那个写。dragOver 时高亮。
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    if (!active) return; // 只有激活的会话面板才响应（隐藏的不抢拖放）
    let un: (() => void) | undefined;
    let cancelled = false;
    const hostHit = (x: number, y: number) => {
      const el = hostRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      // onDragDropEvent 的 position 是物理像素，需除以 devicePixelRatio 换算成 CSS 像素
      const dpr = window.devicePixelRatio || 1;
      const cx = x / dpr;
      const cy = y / dpr;
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "over") {
          setDragOver(hostHit(p.position.x, p.position.y));
        } else if (p.type === "drop") {
          const hit = hostHit(p.position.x, p.position.y);
          setDragOver(false);
          if (hit && p.paths && p.paths.length) pasteToActive(pathsToCmdText(p.paths));
        } else {
          setDragOver(false); // leave/cancel
        }
      })
      .then((f) => {
        if (cancelled) f();
        else un = f;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      un?.();
    };
  }, [active, hostRef, pasteToActive]);
  // 内置快捷词（不可删）；prompts 传了就用 prompts（工具型会话场景）
  const builtins = prompts ?? QUICK_TOOLS;

  // 用户自定义快捷词（可增删，落盘 ~/.opencodex/quick_cmds.json）
  const [custom, setCustom] = useState<QuickCmd[]>([]);
  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCmd, setDraftCmd] = useState("");
  useEffect(() => {
    invoke<QuickCmd[]>("get_quick_cmds").then(setCustom).catch(() => {});
  }, []);
  const persist = (next: QuickCmd[]) => {
    setCustom(next);
    invoke("set_quick_cmds", { cmds: next }).catch(() => {});
  };
  const addCustom = () => {
    const label = draftLabel.trim();
    // 命令留空则等于用标签当命令（如直接加 "/model"）
    const cmd = (draftCmd.trim() || label).trim();
    if (!label) return;
    persist([...custom.filter((c) => c.label !== label), { label, cmd }]);
    setDraftLabel("");
    setDraftCmd("");
    setAdding(false);
  };
  const removeCustom = (label: string) => persist(custom.filter((c) => c.label !== label));

  // 关闭防误触：第一次点 × 进入「待确认」（按钮变红 ✓），2 秒内再点一次才真关闭，
  // 否则自动撤销。避免手滑把跑着 claude code 的终端一下点没了。
  const [confirmKey, setConfirmKey] = useState<number | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseClick = (key: number) => {
    if (confirmKey === key) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmKey(null);
      closeTerm(key);
    } else {
      setConfirmKey(key);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmKey(null), 2000);
    }
  };
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  // 透出 runInActive 给父级（ToolAppView 一键开 WebUI 用）
  useEffect(() => {
    onReady?.({ runCmd: runInActive });
  }, [onReady, runInActive]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 标签栏 */}
      <div className="flex items-center h-8 px-2 gap-1 border-b border-white/[0.06] bg-bg-1 shrink-0">
        <div className="flex items-center gap-1 min-w-0 shrink overflow-x-auto">
          {tabs.map((t) => {
            const pending = confirmKey === t.key;
            return (
              <div
                key={t.key}
                onClick={() => setActiveKey(t.key)}
                className={
                  "group flex items-center gap-1.5 h-6 pl-2.5 pr-1 rounded cursor-pointer text-[12px] shrink-0 " +
                  (t.key === activeKey ? "bg-accent/[0.12] text-ink-0" : "text-ink-3 hover:bg-white/[0.04]")
                }
              >
                <span className="dot dot-on" />
                <span className="whitespace-nowrap">{t.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseClick(t.key);
                  }}
                  className={
                    "inline-flex items-center justify-center w-4 h-4 rounded ml-0.5 transition-all " +
                    (pending
                      ? "opacity-100 bg-danger-500/90 text-white" // 待确认：红底，再点一次才真关
                      : "opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]")
                  }
                  title={pending ? "再点一次确认关闭" : "关闭此终端"}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => newTerm()}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-2 bg-white/[0.04] border border-white/[0.10] hover:text-ink-0 hover:bg-accent/[0.18] hover:border-accent/40 shrink-0 transition-colors"
            title="新建终端标签"
          >
            <Plus size={14} />
          </button>
          {/* 字号调节：A- / 当前值 / A+（也可用 Ctrl +/- 调，Ctrl 0 复位） */}
          <div className="flex items-center gap-0.5 ml-1.5 pl-1.5 border-l border-white/[0.06] shrink-0">
            <button
              onClick={() => bumpFontSize(-1)}
              title="字号减小（Ctrl -）"
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[13px] leading-none text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
            >
              −
            </button>
            <span className="text-[10px] text-ink-4 tabular-nums w-4 text-center" title="当前字号">{fontSize}</span>
            <button
              onClick={() => bumpFontSize(1)}
              title="字号增大（Ctrl +）"
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[13px] leading-none text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
            >
              +
            </button>
          </div>
        </div>
        {/* 快捷词：内置（claude/codex…，不可删）+ 用户自定义（可删）+ 添加。
            占满剩余空间；按钮过多时内层横向滚动，+ 永远固定在最右不被挤掉。 */}
        <div className="relative flex items-center flex-1 min-w-0 pl-2 ml-1 border-l border-white/[0.06]">
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto flex-1 no-scrollbar">
            {builtins.map((q) => (
              <button
                key={q.label}
                onClick={() => runInActive(q.cmd)}
                title={`在终端运行：${q.cmd}`}
                className="h-6 px-2 rounded text-[11px] text-ink-3 hover:text-ink-0 hover:bg-accent/[0.14] transition-colors shrink-0"
              >
                {q.label}
              </button>
            ))}
            {custom.map((q) => (
              <span key={q.label} className="group/cmd relative inline-flex items-center shrink-0">
                <button
                  onClick={() => runInActive(q.cmd)}
                  title={`在终端运行：${q.cmd}`}
                  className="h-6 pl-2 pr-2 rounded text-[11px] text-accent-400 hover:text-ink-0 hover:bg-accent/[0.18] transition-colors"
                >
                  {q.label}
                </button>
                <button
                  onClick={() => removeCustom(q.label)}
                  title="删除此快捷词"
                  className="opacity-0 group-hover/cmd:opacity-100 absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-danger-500 text-white flex items-center justify-center transition-opacity"
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
          {/* 添加按钮固定在最右，永远可见 */}
          <button
            onClick={() => setAdding((v) => !v)}
            title="添加常用快捷词（如 /model、ccd）"
            className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-2 bg-white/[0.04] border border-white/[0.10] hover:text-ink-0 hover:bg-accent/[0.18] hover:border-accent/40 shrink-0 ml-1 transition-colors"
          >
            <Plus size={13} />
          </button>

          {/* 添加弹层 */}
          {adding && (
            <div className="absolute right-0 top-8 z-40 w-60 rounded-card border border-white/[0.12] bg-bg-2 shadow-card p-2.5 space-y-2">
              <div className="text-[11px] text-ink-3">添加快捷词（点按钮即发进终端执行）</div>
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="按钮文字（如 /model）"
                className="w-full h-7 px-2 rounded bg-bg-1 border border-white/[0.10] text-[12px] text-ink-1 outline-none focus:border-accent/50"
              />
              <input
                value={draftCmd}
                onChange={(e) => setDraftCmd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
                placeholder="发送的命令（留空=同按钮文字）"
                className="w-full h-7 px-2 rounded bg-bg-1 border border-white/[0.10] text-[12px] text-ink-1 outline-none focus:border-accent/50"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  onClick={() => {
                    setAdding(false);
                    setDraftLabel("");
                    setDraftCmd("");
                  }}
                  className="h-7 px-2.5 rounded text-[12px] text-ink-3 hover:bg-white/[0.05]"
                >
                  取消
                </button>
                <button
                  onClick={addCustom}
                  className="h-7 px-3 rounded text-[12px] bg-accent/[0.18] text-accent-400 hover:bg-accent/[0.28]"
                >
                  添加
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 终端宿主 */}
      <div ref={hostRef} className="relative flex-1 min-h-0 bg-[#0d0d0f]">
        {dragOver && (
          <div className="pointer-events-none absolute inset-1 z-20 rounded-md border-2 border-dashed border-accent/70 bg-accent/[0.08] flex items-center justify-center">
            <span className="text-[12px] text-accent-400 bg-bg-2/90 px-2.5 py-1 rounded">松手把路径填进命令行</span>
          </div>
        )}
      </div>
    </div>
  );
}
