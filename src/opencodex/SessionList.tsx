/**
 * 左侧列表 —— 按项目（文件夹）分组，每个项目下列多个 AI 会话（claude/codex/openclaw…）。
 * 顶部 RunPanel（我的 AI 运行面板）；底部「插件 / 自动化」占位。
 * status 小圆点：idle 灰 / running 绿 / error 红。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Download, FolderPlus, GitBranch, GripVertical, MessageSquarePlus, Plus, Puzzle, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Task, TaskStatus } from "./types";
import { dirBasename, normDir } from "./types";
import { useWorkbench } from "./store";
import { askConfirm } from "../lib/confirm";
import { useI18n } from "../i18n";

/**
 * 状态灯四态（对齐 U-King 0.9.83 测试报告 #008 的 Standby 一档）。
 *
 * 老逻辑只有「跑着=绿 / 其余=灰」，于是**聊过一半、随时能接着聊**的会话跟一个空白新会话
 * 长得一模一样 —— 用户读到的是「离线」，实际它只是这一秒没在说话。这不是审美问题：
 * 灰色会让人以为得重开一个，于是同一个文件夹开出好几个会话。
 *
 *   在线     dot-on       正在跑
 *   Standby dot-standby  有对话历史、当前空闲 —— 点进去就接着聊（--resume 真的续得上）
 *   离线     dot-off      全新会话，一句话都没说过
 *   出错     dot-error    上一轮失败
 */
function statusDot(s: TaskStatus, hasHistory: boolean): string {
  if (s === "running") return "dot-on";
  if (s === "error") return "dot-error";
  return hasHistory ? "dot-standby" : "dot-off";
}

function statusTitle(s: TaskStatus, hasHistory: boolean): string {
  if (s === "running") return "Running";
  if (s === "error") return "Last run failed";
  return hasHistory ? "Standby — has history, click to resume" : "Idle — no messages yet";
}

const ADD_TOOLS: { tool: string; name: string; cmd: string }[] = [
  { tool: "claude", name: "Claude Code", cmd: "claude" },
  { tool: "codex", name: "Codex", cmd: "codex" },
  { tool: "gemini", name: "Gemini CLI", cmd: "gemini" },
  { tool: "opencode", name: "opencode", cmd: "opencode" },
  { tool: "aider", name: "Aider", cmd: "aider" },
];

export function SessionList({ onToast }: { onToast?: (s: string) => void } = {}) {
  const { t: tr } = useI18n();
  const { state, addTask, addSession, addWorktree, removeTask, removeProject, reorderTasks, reloadTasks, renameTask, activate } =
    useWorkbench();
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);

  // 从 U-King 工作台导入会话（~/.uking/tasks.json → ~/.opencodex/tasks.json，按目录去重合并）。
  // 场景：用户同时在用 U-King 和 OpenCodex，U-King 左侧攒下的项目/会话想在新工作台接着用。
  const [importing, setImporting] = useState(false);
  const importFromUking = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const r = await invoke<{ imported: number; skipped: number; source_exists: boolean }>(
        "import_uking_tasks",
      );
      if (!r.source_exists) {
        onToast?.(tr("No U-King workspace data found (~/.uking/tasks.json)"));
      } else if (r.imported > 0) {
        onToast?.(tr("Imported {n} project session(s) from U-King ({s} already present)", { n: r.imported, s: r.skipped }));
        reloadTasks(); // 后端已合并，重拉列表
      } else {
        onToast?.(tr("Nothing to import — all {n} U-King project(s) already here", { n: r.skipped }));
      }
    } catch (e) {
      onToast?.(tr("Import failed: {e}", { e: String(e) }));
    } finally {
      setImporting(false);
    }
  };

  // 正在重命名的会话 id + 输入框内容（对齐 U-King 测试报告 #016）。双击名字进入，
  // 回车/失焦保存，Esc 取消。
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);

  // Standby 灯的依据：哪些会话有对话历史。session_id 落在后端 kv.json（agent.session.<task_id>），
  // 聊过就有，重启也不丢。挂在 tasks + activeId 上重算 —— 从某个会话切走时它多半刚聊过。
  const [chatted, setChatted] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    invoke<string[]>("chatted_tasks")
      .then((ids) => {
        if (alive) setChatted(new Set(ids));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state.tasks, state.activeId]);

  // git repo 检测缓存：projKey → boolean。首次渲染某个项目时异步检测，后续不重复。
  const [gitRepos, setGitRepos] = useState<Record<string, boolean>>({});
  const checkedDirsRef = useRef<Set<string>>(new Set());

  // worktree 输入状态
  const [worktreeInputFor, setWorktreeInputFor] = useState<string | null>(null);
  const [worktreeRepoRoot, setWorktreeRepoRoot] = useState<string | null>(null);
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [worktreeCreate, setWorktreeCreate] = useState(false);
  const [worktreeLoading, setWorktreeLoading] = useState(false);

  // 关闭会话 —— **聊过的一律弹真确认框**（`askConfirm`，不是「再点一次」的土办法）。
  //
  // 原来是点两次红叉：一个小按钮变个色，2 秒内再点一次就没了。问题不在「能不能防手滑」，
  // 在**它什么都没告诉你**：你不知道这一下要丢的是几十轮对话还是一个空壳。而 `removeTask`
  // 之后那份 session 记录就再也回不来了 —— 新建同文件夹的会话拿的是新 id，历史找不回。
  // 这种代价必须先说清楚再问。
  //
  // **空会话不弹框**：一句话都没说过的会话（无 session_id），拦一下纯属烦人。有历史才拦。
  // `askConfirm` fail-closed（弹不出来 = 当成没同意），绝不会出现「没问就删了」。
  const onDelClick = async (id: string) => {
    if (chatted.has(id)) {
      const okd = await askConfirm(
        tr("Close this session? It has a conversation history, which can't be recovered.\n(The folder on disk is untouched — only this session and its chat record go away.)"),
      );
      if (!okd) return;
    }
    // 清掉它的 session 记录（否则 kv.json 里留个孤儿 key，Standby 判定会误判）
    await invoke("kv_set", { key: `agent.session.${id}`, value: null }).catch(() => {});
    void removeTask(id);
  };

  // 整组删除：比关单个更狠（一次干掉整个项目下所有会话），同样先算清代价再问。
  const onDelGroupClick = async (_projKey: string, ids: string[]) => {
    const chattedCount = ids.filter((id) => chatted.has(id)).length;
    const okd = await askConfirm(
      chattedCount > 0
        ? tr("Close all {n} session(s) in this project? {c} of them have conversation history that can't be recovered.\n(The folder on disk is untouched.)", { n: ids.length, c: chattedCount })
        : tr("Close all {n} session(s) in this project? (None have chat history yet; the folder on disk is untouched.)", { n: ids.length }),
    );
    if (!okd) return;
    for (const id of ids) {
      await invoke("kv_set", { key: `agent.session.${id}`, value: null }).catch(() => {});
    }
    void removeProject(ids);
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
    const dir = await openDialog({ directory: true, multiple: false, title: tr("Select a project folder") });
    if (typeof dir === "string" && dir) await addTask(dir, "manual", false);
  };

  // 新建对话：在当前激活项目下开一个 claude 会话；没有激活项目则先选文件夹建项目
  const newChat = async () => {
    const active = state.tasks.find((t) => t.id === state.activeId);
    const dir = active?.dir;
    if (dir) {
      addSession(dir, "claude", tr("New chat"), "claude");
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

  // 每当 groups 变化时，检测未查过的项目是否是 git repo
  useEffect(() => {
    for (const [, tasks] of groups) {
      const mainTask = tasks.find((t) => !t.worktree_repo);
      if (!mainTask) continue; // 全是 worktree 任务 → 已知是 git repo，跳过
      const key = normDir(mainTask.dir);
      if (checkedDirsRef.current.has(key)) continue;
      checkedDirsRef.current.add(key);
      invoke<boolean>("git_is_repo", { path: mainTask.dir })
        .then((result) => setGitRepos((prev) => ({ ...prev, [key]: result })))
        .catch(() => {});
    }
  }, [groups]);

  const doCreateWorktree = async () => {
    if (!worktreeBranch.trim() || !worktreeRepoRoot) return;
    setWorktreeLoading(true);
    try {
      await addWorktree(worktreeRepoRoot, worktreeBranch.trim(), worktreeCreate);
      setWorktreeInputFor(null);
      setWorktreeRepoRoot(null);
      setWorktreeBranch("");
    } catch (e) {
      alert(tr("Failed to create worktree: {e}", { e: String(e) }));
    } finally {
      setWorktreeLoading(false);
    }
  };

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

  // 会话栏宽度 + 折叠：本地持久化（不进 tasks.json，纯视图偏好）。拖右边缘调宽（180~460px），
  // 双击边缘或点收起按钮 = 折叠成窄条，把地方全让给右侧终端；再点展开恢复原宽。
  const MIN_W = 180, MAX_W = 460;
  const [width, setWidth] = useState<number>(() => {
    const v = parseInt(localStorage.getItem("opencodex.sidebar.width") || "", 10);
    return v >= MIN_W && v <= MAX_W ? v : 230;
  });
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem("opencodex.sidebar.collapsed") === "1",
  );

  // 单个项目组的折叠（缩进/隐藏）：纯视图偏好，按 projKey 记在 localStorage，不进 tasks.json。
  // 点项目头前面的箭头 = 把该项目下的会话收起来，给别的项目腾地方；再点展开。
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("opencodex.groups.collapsed") || "{}") || {};
    } catch {
      return {};
    }
  });
  const toggleGroup = (projKey: string) =>
    setCollapsedGroups((prev) => {
      const next = { ...prev, [projKey]: !prev[projKey] };
      if (!next[projKey]) delete next[projKey]; // 展开态不落盘，键表保持精简
      try { localStorage.setItem("opencodex.groups.collapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  const widthRef = useRef(width);
  widthRef.current = width;
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const n = !c;
      try { localStorage.setItem("opencodex.sidebar.collapsed", n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });
  // 右边缘拖拽调宽：pointer 事件（不是 HTML5 draggable，和会话/项目排序拖拽互不干扰）
  const beginResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const move = (ev: PointerEvent) => {
      setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem("opencodex.sidebar.width", String(widthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // 折叠态：窄条 rail —— 只留展开 + 新建对话 + 新建项目三个图标，把空间全让给终端
  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 flex flex-col items-center gap-1 py-2 border-r border-white/[0.06] bg-bg-1 min-h-0">
        <button
          onClick={toggleCollapsed}
          title={tr("Expand session bar")}
          className="w-8 h-8 grid place-items-center rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
        >
          <ChevronsRight size={16} />
        </button>
        <button
          onClick={newChat}
          title={tr("New chat")}
          className="w-8 h-8 grid place-items-center rounded text-accent-400 hover:bg-accent/[0.16]"
        >
          <MessageSquarePlus size={16} />
        </button>
        <button
          onClick={pickFolder}
          title={tr("New project (pick a folder)")}
          className="w-8 h-8 grid place-items-center rounded text-ink-3 hover:text-ink-0 hover:bg-white/[0.06]"
        >
          <FolderPlus size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width }}
      className="relative shrink-0 flex flex-col border-r border-white/[0.06] bg-bg-1 min-h-0"
    >
      {/* 顶部品牌条 + 收起按钮 */}
      <div className="px-3 pt-3 pb-1 shrink-0 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{tr("Sessions")}</span>
        <button
          onClick={toggleCollapsed}
          title={tr("Collapse session bar (give the space to the terminal)")}
          className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06]"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>

      {/* 新建对话（主）+ 新建项目（次）—— Codex 式入口 */}
      <div className="px-2.5 pt-2 pb-1.5 shrink-0 space-y-1">
        <button
          onClick={newChat}
          className="w-full inline-flex items-center gap-2 h-8 px-2.5 rounded-card bg-accent/[0.14] text-accent-400 hover:bg-accent/[0.20] text-[12.5px] font-medium"
        >
          <MessageSquarePlus size={14} />
          {tr("New chat")}
        </button>
        <button
          onClick={pickFolder}
          className="w-full inline-flex items-center gap-2 h-7 px-2.5 rounded-card text-ink-3 hover:bg-white/[0.04] text-[12px]"
          title={tr("Pick a folder to start a project")}
        >
          <FolderPlus size={13} />
          {tr("New project (pick a folder)")}
        </button>
      </div>
      <div className="px-3 pb-1 shrink-0 text-[11px] text-ink-5">{tr("Open projects")}</div>

      <div className="flex-1 overflow-y-auto py-1.5 min-h-0">
        {state.tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-ink-4 text-[12px] leading-relaxed">
            {tr("No projects yet.")}
            <br />
            {tr('Click "New" to pick a folder')}
            <br />
            {tr("and put several AIs to work in it.")}
          </div>
        ) : (
          groups.map(([projKey, tasks]) => {
            // 找主仓库任务（无 worktree_repo）和任意一个 worktree 任务
            const nonWorktreeTask = tasks.find((t) => !t.worktree_repo);
            const anyWorktreeTask = tasks.find((t) => !!t.worktree_repo);
            // 用于显示项目名的 dir：优先主仓库 dir，其次从 worktree_repo 取
            const projDisplayDir = nonWorktreeTask?.dir ?? anyWorktreeTask?.worktree_repo ?? tasks[0].dir;
            const projName = projKey ? dirBasename(projDisplayDir) : "No folder";
            // 用于创建新 worktree 的 git 根目录
            const repoRoot = nonWorktreeTask?.dir ?? anyWorktreeTask?.worktree_repo ?? null;
            // 有 worktree 任务 → 已知是 git repo；否则查检测缓存
            const isGitProject =
              !!anyWorktreeTask || (repoRoot ? !!gitRepos[normDir(repoRoot)] : false);
            // 该项目组是否折叠（缩进隐藏其会话）
            const groupCollapsed = !!collapsedGroups[projKey];

            return (
              <div
                key={projKey || "_loose"}
                className="mb-1.5"
                onDragOver={(e) => {
                  if (dragRef.current?.kind === "group" && dragRef.current.key !== projKey) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOverGroup(projKey);
                  }
                }}
                onDrop={(e) => {
                  const d = dragRef.current;
                  if (d?.kind === "group" && d.key !== projKey) {
                    e.preventDefault();
                    moveGroup(d.key, projKey);
                    clearDrag();
                  }
                }}
              >
                {/* 项目组头：拖拽把手重排顺序；垃圾桶整组删除 */}
                <div
                  draggable
                  onDragStart={(e) => {
                    dragRef.current = { kind: "group", key: projKey };
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", projKey);
                  }}
                  onDragEnd={clearDrag}
                  className={
                    "group flex items-center gap-1 px-2.5 py-1 text-[11px] text-ink-3 select-none cursor-grab active:cursor-grabbing border-t " +
                    (overGroup === projKey ? "border-accent" : "border-transparent")
                  }
                >
                  {/* 折叠箭头：点一下把该项目的会话缩进隐藏，再点展开 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroup(projKey);
                    }}
                    className="inline-flex items-center justify-center w-4 h-4 -ml-1 shrink-0 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]"
                    title={groupCollapsed ? "Expand this project" : "Collapse this project"}
                  >
                    {groupCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <GripVertical
                    size={11}
                    className="shrink-0 text-ink-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                  <span className="flex-1 min-w-0 truncate font-medium" title={projDisplayDir}>
                    {projName}
                  </span>
                  {groupCollapsed && (
                    <span className="shrink-0 text-[10px] text-ink-5 tabular-nums px-1" title={`${tasks.length} session(s) hidden`}>
                      {tasks.length}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelGroupClick(
                        projKey,
                        tasks.map((t) => t.id),
                      );
                    }}
                    className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-all opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]"
                    title={tr("Delete the whole project (removes all its sessions; the folder on disk is untouched)")}
                  >
                    <Trash2 size={12} />
                  </button>
                  {/* worktree 按钮：仅 git 项目显示 */}
                  {isGitProject && repoRoot && projKey && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (worktreeInputFor === projKey) {
                          setWorktreeInputFor(null);
                          setWorktreeRepoRoot(null);
                        } else {
                          setWorktreeInputFor(projKey);
                          setWorktreeRepoRoot(repoRoot);
                          setWorktreeBranch("");
                          setWorktreeCreate(false);
                        }
                      }}
                      className={
                        "inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-all " +
                        (worktreeInputFor === projKey
                          ? "opacity-100 text-accent-400 bg-accent/[0.12]"
                          : "opacity-0 group-hover:opacity-100 text-ink-4 hover:text-accent-400 hover:bg-white/[0.06]")
                      }
                      title={tr("New worktree (work on another branch in parallel)")}
                    >
                      <GitBranch size={12} />
                    </button>
                  )}
                  {projKey && (
                    <div className="relative">
                      <button
                        onClick={() => setAddMenuFor(addMenuFor === projKey ? null : projKey)}
                        className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-accent-400 hover:bg-white/[0.06]"
                        title={tr("Open a new AI session in this project")}
                      >
                        <Plus size={12} />
                      </button>
                      {addMenuFor === projKey && (
                        <div className="absolute right-0 top-6 z-30 w-36 rounded-card border border-white/[0.10] bg-bg-2 shadow-card p-1">
                          {ADD_TOOLS.map((a) => (
                            <button
                              key={a.tool}
                              onClick={() => {
                                addSession(projDisplayDir, a.tool, a.name, a.cmd);
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

                {/* worktree 分支输入行（内联展开，不弹新窗口） */}
                {!groupCollapsed && worktreeInputFor === projKey && (
                  <div className="mx-1.5 mb-1 flex items-center gap-1 px-2 py-1 rounded-card bg-white/[0.04] border border-white/[0.08]">
                    <GitBranch size={11} className="shrink-0 text-accent-400" />
                    <input
                      autoFocus
                      value={worktreeBranch}
                      onChange={(e) => setWorktreeBranch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void doCreateWorktree();
                        if (e.key === "Escape") setWorktreeInputFor(null);
                      }}
                      placeholder={tr("Branch name (Enter to confirm)")}
                      className="flex-1 min-w-0 bg-transparent text-[11.5px] text-ink-1 placeholder:text-ink-5 outline-none"
                    />
                    <label className="flex items-center gap-1 text-[10.5px] text-ink-4 shrink-0 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={worktreeCreate}
                        onChange={(e) => setWorktreeCreate(e.target.checked)}
                        className="accent-accent-400"
                      />
                      {tr("New")}
                    </label>
                    <button
                      onClick={() => void doCreateWorktree()}
                      disabled={!worktreeBranch.trim() || worktreeLoading}
                      className="text-[11px] px-1 text-accent-400 hover:text-accent-300 disabled:opacity-40 shrink-0"
                    >
                      {worktreeLoading ? "…" : "✓"}
                    </button>
                    <button
                      onClick={() => {
                        setWorktreeInputFor(null);
                        setWorktreeRepoRoot(null);
                      }}
                      className="inline-flex items-center justify-center w-4 h-4 rounded text-ink-4 hover:text-ink-2 shrink-0"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}

                {/* 该项目的会话（折叠时缩进隐藏） */}
                {!groupCollapsed && tasks.map((t) => {
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
                        // 项目组拖拽要继续冒泡给外层组容器处理，不能在会话行提前清空。
                        if (d?.kind !== "session") return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (d.group === projKey) moveSession(d.key, t.id, projKey);
                        clearDrag();
                      }}
                      className={
                        "group flex items-center gap-2 ml-4 mr-1.5 mb-0.5 pl-3 pr-1.5 py-1.5 rounded-card cursor-pointer select-none border-l-2 border-t-2 " +
                        (overSession === t.id ? "border-t-accent " : "border-t-transparent ") +
                        (on ? "bg-accent/[0.10] border-l-accent" : "border-l-transparent hover:bg-white/[0.03]")
                      }
                      title={t.dir}
                    >
                      <span
                        className={"dot " + statusDot(t.status, chatted.has(t.id))}
                        title={tr(statusTitle(t.status, chatted.has(t.id)))}
                      />
                      {renaming?.id === t.id ? (
                        // 重命名输入框：拦掉 click/pointerdown，否则会触发选中会话和拖拽
                        <input
                          autoFocus
                          value={renaming.text}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => setRenaming({ id: t.id, text: e.target.value })}
                          onBlur={() => {
                            void renameTask(t.id, renaming.text);
                            setRenaming(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void renameTask(t.id, renaming.text);
                              setRenaming(null);
                            } else if (e.key === "Escape") {
                              setRenaming(null); // 原名不动
                            }
                          }}
                          className="flex-1 min-w-0 h-5 px-1 rounded bg-black/20 border border-accent/50 text-[12.5px] text-ink-0 outline-none"
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenaming({ id: t.id, text: t.name || dirBasename(t.dir) });
                          }}
                          title={tr("Double-click to rename")}
                          className={"flex-1 min-w-0 truncate text-[12.5px] " + (on ? "text-ink-0" : "text-ink-1")}
                        >
                          {t.worktree_branch
                            ? `⎇ ${t.worktree_branch}`
                            : t.tool ? t.name : t.name || dirBasename(t.dir)}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelClick(t.id);
                        }}
                        className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 transition-all opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-1 hover:bg-white/[0.08]"
                        title={tr("Close session (asks first if it has history; the folder on disk is untouched)")}
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
          {tr("Plugins (coming soon)")}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void importFromUking()}
            disabled={importing}
            title={tr("Import projects & sessions from U-King workspace (~/.uking/tasks.json)")}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded text-ink-5 hover:text-ink-2 hover:bg-white/[0.05] disabled:opacity-40"
          >
            <Download size={11} />
            {importing ? tr("Importing…") : tr("Import U-King")}
          </button>
          <span className="text-[10px] font-mono text-ink-5 px-1.5 py-0.5 rounded bg-white/[0.04]" title={tr("OpenCodex version")}>
            v{__APP_VERSION__}
          </span>
        </div>
      </div>

      {/* 右边缘拖拽条：拖动调宽，双击收起。骑在右边框上（往右探出一半便于抓取） */}
      <div
        onPointerDown={beginResize}
        onDoubleClick={toggleCollapsed}
        title={tr("Drag to resize the session bar · double-click to collapse")}
        className="absolute top-0 right-0 bottom-0 w-1.5 translate-x-1/2 z-20 cursor-col-resize hover:bg-accent/50 transition-colors"
      />
    </aside>
  );
}
