/**
 * OpenCodex 工作台主框架 —— Codex 桌面版一比一：两区布局。
 *
 * 布局：左 SessionList（项目/会话列表）| 右 一个大对话面（ChatColumn 自带顶栏开关 +
 * 右侧滑出的终端/文件/浏览器）。砍掉了旧的常驻右终端栏、底部抽屉、最右 AuxBar 竖条。
 * 保活：每个会话整组常驻渲染，靠 display 切换显示，切会话不杀 PTY/会话历史。
 */
import { useEffect, useRef } from "react";
import { FolderPlus } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { WorkbenchProvider, useWorkbench } from "./store";
import type { Task } from "./types";
import { SessionList } from "./SessionList";
import { ChatColumn } from "./SplitArea";

type Props = {
  openedDir: string | null;
  homeDir: string | null;
  onToast: (s: string) => void;
  onGoManage: () => void;
};

function WorkbenchInner({ openedDir, homeDir, onToast, onGoManage }: Props) {
  const { state, addTask } = useWorkbench();
  const consumedDir = useRef<string | null>(null);
  const autoCreated = useRef(false);

  // 命令行 --open-dir 透传的目录 → 自动建会话并激活（reuse：同文件夹已有则激活）
  useEffect(() => {
    if (!state.loaded || !openedDir || consumedDir.current === openedDir) return;
    consumedDir.current = openedDir;
    void addTask(openedDir, "context_menu", true);
  }, [state.loaded, openedDir, addTask]);

  // 默认能聊：加载后若一个会话都没有，自动用主目录建一个 —— 不必先选文件夹
  useEffect(() => {
    if (!state.loaded || autoCreated.current) return;
    if (state.tasks.length === 0 && homeDir) {
      autoCreated.current = true;
      void addTask(homeDir, "manual", true);
    }
  }, [state.loaded, state.tasks.length, homeDir, addTask]);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "选择项目文件夹" });
    if (typeof dir === "string" && dir) await addTask(dir, "manual", false);
  };

  return (
    <div className="flex h-full min-h-0 rounded-card border border-white/[0.08] overflow-hidden bg-bg-2">
      <SessionList />
      <div className="flex-1 min-w-0 min-h-0 relative">
        {state.tasks.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="text-ink-1 text-[15px] font-medium">打开一个文件夹，开始干活</div>
            <div className="text-ink-4 text-[13px] leading-relaxed max-w-sm">
              选一个文件夹，主区直接是终端 —— 跑 claude / codex，
              随手左右/上下分屏多开。需要时从顶栏开文件树、浏览器。
            </div>
            <button
              onClick={pickFolder}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-accent hover:bg-accent-600 text-white text-[13px] font-medium"
            >
              <FolderPlus size={15} />
              新建项目（选文件夹）
            </button>
          </div>
        ) : (
          state.tasks.map((t: Task) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ display: state.activeId === t.id ? "block" : "none" }}
            >
              <ChatColumn
                task={t}
                active={state.activeId === t.id}
                onToast={onToast}
                onGoManage={onGoManage}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function OpenCodex(props: Props) {
  return (
    <WorkbenchProvider>
      <WorkbenchInner {...props} />
    </WorkbenchProvider>
  );
}
