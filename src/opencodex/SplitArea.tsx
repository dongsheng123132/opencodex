/**
 * OpenCodex 主区 —— 终端为主（不再有对话面板）。
 *
 * 设计取向（对照 Crystal / Wave Terminal）：打开一个文件夹 = 主区直接铺满终端，
 * 直接跑 claude / codex。砍掉了旧的「和 Claude Code 对话」输入框 + 动态刷新
 * （它白占主区、还高频重绘抢焦点 → 输入框"消失"）。
 *
 * ChatColumn（名字保留，避免动 OpenCodex.tsx）：
 *   顶栏（任务名 + 切模型 + 文件/浏览器开关 + 终端分屏）+ 主区终端（SplitContainer，可分屏）。
 *   文件/浏览器从右侧滑出（覆盖终端右半），关掉回到全宽终端。都靠 display 切换保活。
 */
import { useCallback, useRef } from "react";
import { Columns2, Cpu, FolderTree, Globe, Rows2, X } from "lucide-react";
import type { RightKind, Task } from "./types";
import { useWorkbench } from "./store";
import { SplitContainer, type SplitApi } from "./term/SplitContainer";
import { FilesPanel } from "./panels/FilesPanel";
import { BrowserPanel } from "./panels/BrowserPanel";

// 右侧滑出层只放文件/浏览器（终端是主区，不再是滑出项）
const RIGHT_META: { kind: Exclude<RightKind, "terminal">; label: string; icon: typeof FolderTree }[] = [
  { kind: "files", label: "文件", icon: FolderTree },
  { kind: "browser", label: "浏览器", icon: Globe },
];

/**
 * 主区：终端铺满 + 顶栏开关 + 右侧滑出（文件/浏览器）。
 */
export function ChatColumn({
  task,
  active,
  onGoManage,
}: {
  task: Task;
  active: boolean;
  onToast: (s: string) => void;
  onGoManage: () => void;
}) {
  const { state, setRight, toggleRight, setRatio } = useWorkbench();
  const layout = state.panels[task.id];
  // rightKind 现在只用于文件/浏览器；terminal 永远是主区。
  // 旧持久化数据里可能残留 "terminal" → 收敛成 "files"（terminal 不再是滑出项）。
  const rightKind: Exclude<RightKind, "terminal"> =
    layout?.rightKind === "browser" ? "browser" : "files";
  const rightOpen = layout?.rightOpen ?? false;
  const ratio = layout?.rightRatio ?? 0.5;

  const rowRef = useRef<HTMLDivElement>(null);
  const splitApiRef = useRef<SplitApi | null>(null);
  const onSplitReady = useCallback((api: SplitApi) => {
    splitApiRef.current = api;
  }, []);

  // 滑出面板宽度拖动（从分隔条往左拖加宽面板）
  const onDragRatio = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = rowRef.current;
      if (!el) return;
      const move = (ev: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        setRatio(task.id, (ev.clientX - rect.left) / rect.width);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [task.id, setRatio],
  );

  // 点顶栏文件/浏览器：已开且同类 → 关；否则切到该类并展开
  const onPick = (k: Exclude<RightKind, "terminal">) => {
    if (rightOpen && rightKind === k) toggleRight(task.id, false);
    else setRight(task.id, k);
  };

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* 顶栏：任务名 + 目录 + 切模型 + 终端分屏 + 文件/浏览器开关 */}
      <div className="flex items-center h-10 px-3 border-b border-white/[0.06] bg-bg-1 shrink-0 gap-2">
        <span className="text-[13px] font-medium text-ink-0 truncate">{task.name}</span>
        {task.tool && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/[0.14] text-accent-400 shrink-0">
            {task.tool}
          </span>
        )}
        <span className="text-ink-5 text-[11px] truncate max-w-[30%] font-mono hidden lg:inline" title={task.dir}>
          {task.dir}
        </span>
        <div className="flex-1" />

        {/* 终端分屏（主区就是终端，直接给分屏入口） */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => splitApiRef.current?.splitLast("row")}
            title="左右分屏（再开一个终端）"
            className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-3 hover:text-ink-0 hover:bg-accent/[0.18] transition-colors"
          >
            <Columns2 size={14} />
          </button>
          <button
            onClick={() => splitApiRef.current?.splitLast("col")}
            title="上下分屏（再开一个终端）"
            className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-3 hover:text-ink-0 hover:bg-accent/[0.18] transition-colors"
          >
            <Rows2 size={14} />
          </button>
        </div>

        {/* 模型设置 */}
        <button
          onClick={onGoManage}
          title="模型设置（自带模型）"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12px] transition-colors text-ink-3 hover:bg-white/[0.05] hover:text-ink-1 ml-1 pl-2 border-l border-white/[0.08]"
        >
          <Cpu size={13} />
          <span className="hidden md:inline">模型</span>
        </button>

        {/* 文件/浏览器开关 —— 点了才从右侧滑出 */}
        <div className="flex items-center gap-0.5 ml-1 pl-2 border-l border-white/[0.08]">
          {RIGHT_META.map((p) => {
            const on = rightOpen && rightKind === p.kind;
            const Icon = p.icon;
            return (
              <button
                key={p.kind}
                onClick={() => onPick(p.kind)}
                title={p.label}
                className={
                  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12px] transition-colors " +
                  (on ? "bg-accent/[0.12] text-ink-0" : "text-ink-3 hover:bg-white/[0.05] hover:text-ink-1")
                }
              >
                <Icon size={13} className={on ? "text-accent" : ""} />
                <span className="hidden md:inline">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 主区：终端铺满（rightOpen 时让出右半给文件/浏览器滑出层） */}
      <div ref={rowRef} className="flex flex-1 min-h-0 min-w-0">
        <div className="min-w-0 min-h-0" style={{ flexBasis: rightOpen ? `${ratio * 100}%` : "100%" }}>
          <SplitContainer
            cwd={task.dir}
            active={active}
            tool={task.tool ?? undefined}
            initialCmd={task.startup_cmd ?? undefined}
            storageKey={task.id}
            onReady={onSplitReady}
          />
        </div>
        {rightOpen && (
          <>
            <div
              onMouseDown={onDragRatio}
              className="w-1 shrink-0 bg-white/[0.06] hover:bg-accent/60 cursor-col-resize transition-colors"
            />
            <div className="min-w-0 min-h-0" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
              <SidePanel
                task={task}
                active={active}
                kind={rightKind}
                onClose={() => toggleRight(task.id, false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 右侧滑出面板：文件/浏览器（按需挂载）。 */
function SidePanel({
  task,
  active,
  kind,
  onClose,
}: {
  task: Task;
  active: boolean;
  kind: Exclude<RightKind, "terminal">;
  onClose: () => void;
}) {
  const label = kind === "files" ? "文件" : "浏览器";
  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 border-l border-white/[0.06] bg-bg-2">
      <div className="flex items-center gap-2 h-9 px-3 border-b border-white/[0.06] bg-bg-1 shrink-0">
        <span className="text-[12px] font-medium text-ink-1">{label}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          title="收起"
          className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06]"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {kind === "files" && <FilesPanel root={task.dir} active={active} />}
        {kind === "browser" && <BrowserPanel taskId={task.id} />}
      </div>
    </div>
  );
}
