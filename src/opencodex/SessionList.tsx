/**
 * 左侧列表 —— 按项目（文件夹）分组，每个项目下列多个 AI 会话（claude/codex/openclaw…）。
 * 顶部 RunPanel（我的 AI 运行面板）；底部「插件 / 自动化」占位。
 * status 小圆点：idle 灰 / running 绿 / error 红。
 */
import { useMemo, useRef, useState } from "react";
import { FolderPlus, GripVertical, MessageSquarePlus, Plus, Puzzle, Trash2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Task, TaskStatus } from "./types";
import { dirBasename, normDir } from "./types";
import { useWorkbench } from "./store";

function statusDot(s: TaskStatus): string {
  if (s === "running") return "dot-on";
  if (s === "error") return "dot-warn";
  return "dot-off";
}

const ADD_TOOLS: { tool: string; name: string; cmd: string }[] = [
  { tool: "claude", name: "Claude Code", cmd: "claude" },
  { tool: "codex", name: "Codex", cmd: "codex" },
  { tool: "openclaw", name: "OpenClaw", cmd: "openclaw" },
  { tool: "hermes", name: "Hermes", cmd: "hermes" },
];

export function SessionList() {
  const { state, addTask, addSession, removeTask, removeProject, reorderTasks, activate } =
    useWorkbench();
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);

  // 关闭会话防误触：第一次点 × 进入待确认（按钮变红），2 秒内再点一次才真删，
  // 否则自动撤销。避免手滑把会话卡片（连同布局/终端）一下点没了。
  // 注意：删的只是 OpenCodex 里的会话记录，绝不动磁盘上的文件夹。
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const delTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDelClick = (id: string) => {
    if (confirmDel === id) {
      if (delTimer.current) clearTimeout(delTimer.current);
      setConfirmDel(null);
      void removeTask(id);
    } else {
      setConfirmDel(id);
      if (delTimer.current) clearTimeout(delTimer.current);
      delTimer.current = setTimeout(() => setConfirmDel(null), 2000);
    }
  };

  // 整组删除：和单会话删除同样的「点两次确认」防误触。删的仍只是会话记录，不动磁盘文件夹。
  const [confirmDelGroup, setConfirmDelGroup] = useState<string | null>(null);
  const delGroupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDelGroupClick = (projKey: string, ids: string[]) => {
    if (confirmDelGroup === projKey) {
      if (delGroupTimer.current) clearTimeout(delGroupTimer.current);
      setConfirmDelGroup(null);
      void removeProject(ids);
    } else {
      setConfirmDelGroup(projKey);
      if (delGroupTimer.current) clearTimeout(delGroupTimer.current);
      delGroupTimer.current = setTimeout(() => setConfirmDelGroup(null), 2000);
    }
  };

  // 拖拽排序：dragRef 存当前拖的是「项目组」还是「组内会话」；over* 仅作落点高亮。
  // 用原生 HTML5 拖拽，不引第三方库（守体积红线）。
  const dragRef = useRef<{ kind: "group" | "session"; key: string; group?: string } | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const [overSession, setOverSession] = useState<string | null>(null);
  const clearDrag = () => {
    dragRef.current = null;
    setOverGroup(null);
    setOverSession(null);
  };

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "选择项目文件夹" });
    if (typeof dir === "string" && dir) await addTask(dir, "manual", false);
  };

  // 新建对话：在当前激活项目下开一个 claude 会话；没有激活项目则先选文件夹建项目
  const newChat = async () => {
    const active = state.tasks.find((t) => t.id === state.activeId);
    const dir = active?.dir;
    if (dir) {
      addSession(dir, "claude", "新对话", "claude");
    } else {
      await pickFolder();
    }
  };

  // 按项目（规范化 dir）分组；无 dir 的工具会话归到 "" 组（散会话）
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of state.tasks) {
      const key = t.project ?? (t.dir ? normDir(t.dir) : "");
      const arr = m.get(key) ?? [];
      arr.push(t);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [state.tasks]);

  // 把 from 组整体挪到 to 组之前，重建扁平 id 顺序后落盘。
  const moveGroup = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const keys = groups.map(([k]) => k).filter((k) => k !== fromKey);
    const at = keys.indexOf(toKey);
    if (at < 0) return;
    keys.splice(at, 0, fromKey);
    const byKey = new Map(groups);
    const ids: string[] = [];
    for (const k of keys) for (const t of byKey.get(k) ?? []) ids.push(t.id);
    reorderTasks(ids);
  };

  // 组内把 from 会话挪到 to 会话之前；其它组顺序原样保留。
  const moveSession = (fromId: string, toId: string, projKey: string) => {
    if (fromId === toId) return;
    const ids: string[] = [];
    for (const [k, tasks] of groups) {
      if (k !== projKey) {
        for (const t of tasks) ids.push(t.id);
        continue;
      }
      const moved = tasks.find((t) => t.id === fromId);
      const arr = tasks.filter((t) => t.id !== fromId);
      const at = arr.findIndex((t) => t.id === toId);
      if (moved) arr.splice(at < 0 ? arr.length : at, 0, moved);
      for (const t of arr) ids.push(t.id);
    }
    reorderTasks(ids);
  };

  return (
    <aside className="w-[230px] shrink-0 flex flex-col border-r border-white/[0.06] bg-bg-1 min-h-0">
      {/* 顶部品牌条 */}
      <div className="px-3 pt-3 pb-1 shrink-0 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        会话
      </div>

      {/* 新建对话（主）+ 新建项目（次）—— Codex 式入口 */}
      <div className="px-2.5 pt-2 pb-1.5 shrink-0 space-y-1">
        <button
          onClick={newChat}
          className="w-full inline-flex items-center gap-2 h-8 px-2.5 rounded-card bg-accent/[0.14] text-accent-400 hover:bg-accent/[0.20] text-[12.5px] font-medium"
        >
          <MessageSquarePlus size={14} />
          新建对话
        </button>
        <button
          onClick={pickFolder}
          className="w-full inline-flex items-center gap-2 h-7 px-2.5 rounded-card text-ink-3 hover:bg-white/[0.04] text-[12px]"
          title="选择文件夹新建项目"
        >
          <FolderPlus size={13} />
          新建项目（选文件夹）
        </button>
      </div>
      <div className="px-3 pb-1 shrink-0 text-[11px] text-ink-5">已打开的项目</div>

      <div className="flex-1 overflow-y-auto py-1.5 min-h-0">
        {state.tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-ink-4 text-[12px] leading-relaxed">
            还没有项目。
            <br />
            点「新建」选一个文件夹，
            <br />
            在里面让多个 AI 一起干活。
          </div>
        ) : (
          groups.map(([projKey, tasks]) => {
            const sample = tasks[0];
            const projName = projKey ? dirBasename(sample.dir) : "未绑定文件夹";
            return (
              <div key={projKey || "_loose"} className="mb-1.5">
                {/* 项目组头：拖拽把手重排顺序；垃圾桶整组删除 */}
                <div
                  draggable
                  onDragStart={(e) => {
                    dragRef.current = { kind: "group", key: projKey };
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", projKey);
                  }}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => {
                    if (dragRef.current?.kind === "group" && dragRef.current.key !== projKey) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOverGroup(projKey);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const d = dragRef.current;
                    if (d?.kind === "group") moveGroup(d.key, projKey);
                    clearDrag();
                  }}
                  className={
                    "group flex items-center gap-1 px-2.5 py-1 text-[11px] text-ink-3 select-none cursor-grab active:cursor-grabbing border-t " +
                    (overGroup === projKey ? "border-accent" : "border-transparent")
                  }
                >
                  <GripVertical
                    size={11}
                    className="shrink-0 -ml-1 text-ink-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                  <span className="flex-1 min-w-0 truncate font-medium" title={sample.dir}>
                    {projName}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelGroupClick(
                        projKey,
                        tasks.map((t) => t.id),
                      );
                    }}
                    className={
                      "inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-all " +
                      (confirmDelGroup === projKey
                        ? "opacity-100 bg-danger-500/90 text-white"
                        : "opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]")
                    }
                    title={
                      confirmDelGroup === projKey
                        ? "再点一次：删除该项目下全部会话（不会删除磁盘文件夹）"
                        : "删除整个项目（移除其下所有会话，不动磁盘文件夹）"
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                  {projKey && (
                    <div className="relative">
                      <button
                        onClick={() => setAddMenuFor(addMenuFor === projKey ? null : projKey)}
                        className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-accent-400 hover:bg-white/[0.06]"
                        title="在此项目新开一个 AI 会话"
                      >
                        <Plus size={12} />
                      </button>
                      {addMenuFor === projKey && (
                        <div className="absolute right-0 top-6 z-30 w-36 rounded-card border border-white/[0.10] bg-bg-2 shadow-card p-1">
                          {ADD_TOOLS.map((a) => (
                            <button
                              key={a.tool}
                              onClick={() => {
                                addSession(sample.dir, a.tool, a.name, a.cmd);
                                setAddMenuFor(null);
                              }}
                              className="w-full text-left px-2 py-1.5 rounded text-[12px] text-ink-2 hover:bg-white/[0.05]"
                            >
                              {a.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 该项目的会话 */}
                {tasks.map((t) => {
                  const on = state.activeId === t.id;
                  return (
                    <div
                      key={t.id}
                      draggable
                      onClick={() => activate(t.id)}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        dragRef.current = { kind: "session", key: t.id, group: projKey };
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragEnd={clearDrag}
                      onDragOver={(e) => {
                        const d = dragRef.current;
                        if (d?.kind === "session" && d.group === projKey && d.key !== t.id) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setOverSession(t.id);
                        }
                      }}
                      onDrop={(e) => {
                        const d = dragRef.current;
                        if (d?.kind === "session" && d.group === projKey) {
                          e.preventDefault();
                          moveSession(d.key, t.id, projKey);
                        }
                        clearDrag();
                      }}
                      className={
                        "group flex items-center gap-2 mx-1.5 mb-0.5 pl-3 pr-1.5 py-1.5 rounded-card cursor-pointer select-none border-l-2 border-t-2 " +
                        (overSession === t.id ? "border-t-accent " : "border-t-transparent ") +
                        (on ? "bg-accent/[0.10] border-l-accent" : "border-l-transparent hover:bg-white/[0.03]")
                      }
                      title={t.dir}
                    >
                      <span className={"dot " + statusDot(t.status)} />
                      <span className={"flex-1 min-w-0 truncate text-[12.5px] " + (on ? "text-ink-0" : "text-ink-1")}>
                        {t.tool ? t.name : t.name || dirBasename(t.dir)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelClick(t.id);
                        }}
                        className={
                          "inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-all " +
                          (confirmDel === t.id
                            ? "opacity-100 bg-danger-500/90 text-white" // 待确认：红底，再点一次才真删
                            : "opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]")
                        }
                        title={confirmDel === t.id ? "再点一次确认关闭（不会删除磁盘文件夹）" : "关闭会话"}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* 底部：品牌 + 版本号 */}
      <div className="px-3 py-2 border-t border-white/[0.06] shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-ink-5">
          <Puzzle size={12} />
          插件（即将上线）
        </div>
        <span className="text-[10px] font-mono text-ink-5 px-1.5 py-0.5 rounded bg-white/[0.04]" title="OpenCodex 版本">
          v{__APP_VERSION__}
        </span>
      </div>
    </aside>
  );
}
