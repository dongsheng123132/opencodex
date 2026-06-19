/**
 * 工作台状态 —— useReducer + Context（不引 zustand，守体积红线）。
 *
 * 持久化：任务列表落 ~/.opencodex/tasks.json（后端 tasks.rs）。面板布局只在内存，不落盘。
 * 任务来源（应用内选文件夹 / --open-dir 透传）统一经 addTask 写进同一份 tasks.json。
 */
import { createContext, useContext, useEffect, useReducer, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PanelLayout, RightKind, Task, TaskSource } from "./types";
import { dirBasename, normDir, taskIdFromDir } from "./types";

type State = {
  tasks: Task[];
  activeId: string | null;
  panels: Record<string, PanelLayout>; // sessionId -> 三区布局
  loaded: boolean;
};

type Action =
  | { type: "load"; tasks: Task[] }
  | { type: "upsert"; task: Task }
  | { type: "remove"; id: string }
  | { type: "activate"; id: string }
  | { type: "setRight"; id: string; kind: RightKind }
  | { type: "toggleRight"; id: string; open?: boolean }
  | { type: "setRatio"; id: string; ratio: number }
  | { type: "toggleDrawer"; id: string; open?: boolean }
  | { type: "setDrawerHeight"; id: string; h: number };

const DEFAULT_LAYOUT: PanelLayout = {
  rightKind: "files", // 主区永远是终端；滑出层默认指向文件（点顶栏才滑出）
  rightOpen: false, // 默认全宽终端，文件/浏览器点顶栏才从右滑出
  rightRatio: 0.5,
  drawerOpen: false,
  drawerHeight: 280,
};

/** 终端已是主区，所有会话默认全宽终端，不自动滑出任何东西。 */
function layoutFor(_task: Task): PanelLayout {
  return { ...DEFAULT_LAYOUT };
}

/** 改某会话布局的某个字段（统一模式）。 */
function patchLayout(state: State, id: string, patch: Partial<PanelLayout>): State {
  const cur = state.panels[id] ?? DEFAULT_LAYOUT;
  return { ...state, panels: { ...state.panels, [id]: { ...cur, ...patch } } };
}

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "load": {
      const panels = { ...state.panels };
      for (const t of a.tasks) if (!panels[t.id]) panels[t.id] = layoutFor(t);
      return { ...state, tasks: a.tasks, panels, loaded: true };
    }
    case "upsert": {
      const rest = state.tasks.filter((t) => t.id !== a.task.id);
      const panels = { ...state.panels };
      if (!panels[a.task.id]) panels[a.task.id] = layoutFor(a.task);
      return { ...state, tasks: [a.task, ...rest], activeId: a.task.id, panels };
    }
    case "remove": {
      const tasks = state.tasks.filter((t) => t.id !== a.id);
      const panels = { ...state.panels };
      delete panels[a.id];
      const activeId = state.activeId === a.id ? (tasks[0]?.id ?? null) : state.activeId;
      return { ...state, tasks, panels, activeId };
    }
    case "activate":
      return { ...state, activeId: a.id };
    case "setRight":
      return patchLayout(state, a.id, { rightKind: a.kind, rightOpen: true });
    case "toggleRight": {
      const cur = state.panels[a.id] ?? DEFAULT_LAYOUT;
      return patchLayout(state, a.id, { rightOpen: a.open ?? !cur.rightOpen });
    }
    case "setRatio":
      return patchLayout(state, a.id, { rightRatio: Math.min(0.85, Math.max(0.35, a.ratio)) });
    case "toggleDrawer": {
      const cur = state.panels[a.id] ?? DEFAULT_LAYOUT;
      return patchLayout(state, a.id, { drawerOpen: a.open ?? !cur.drawerOpen });
    }
    case "setDrawerHeight":
      return patchLayout(state, a.id, { drawerHeight: Math.min(900, Math.max(120, a.h)) });
    default:
      return state;
  }
}

type Ctx = {
  state: State;
  /** 新建/激活一个任务（按文件夹）。reuse=true（右键/最近）同文件夹已有会话则激活不新建；
   *  reuse=false（手动新建）每次都新开一个会话。 */
  addTask: (dir: string, source?: TaskSource, reuse?: boolean) => Promise<void>;
  /** 在某项目（dir）下新开一个绑工具的会话（claude/codex/openclaw…）。 */
  addSession: (dir: string, tool: string, name: string, startupCmd: string) => void;
  /** 启动一个工具型会话（无项目文件夹，从「我的 AI」运行面板点启动）。 */
  addToolSession: (tool: string, name: string, startupCmd: string, dir?: string) => void;
  removeTask: (id: string) => Promise<void>;
  activate: (id: string) => void;
  setRight: (id: string, kind: RightKind) => void;
  toggleRight: (id: string, open?: boolean) => void;
  setRatio: (id: string, ratio: number) => void;
  toggleDrawer: (id: string, open?: boolean) => void;
  setDrawerHeight: (id: string, h: number) => void;
};

const WorkbenchCtx = createContext<Ctx | null>(null);

export function WorkbenchProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    tasks: [],
    activeId: null,
    panels: {},
    loaded: false,
  });

  const seq = useRef(0);

  // 启动：拉取持久化任务（旧 tasks.json 补 project/kind 默认，向后兼容）
  useEffect(() => {
    invoke<Task[]>("list_tasks")
      .then((tasks) =>
        dispatch({
          type: "load",
          tasks: tasks.map((t) => ({
            ...t,
            kind: t.kind ?? "task",
            project: t.project ?? normDir(t.dir),
          })),
        }),
      )
      .catch(() => dispatch({ type: "load", tasks: [] }));
  }, []);

  const addTask = useCallback(
    async (dir: string, source: TaskSource = "manual", reuse = false) => {
      const proj = normDir(dir);
      const now = Date.now();
      // reuse（右键/最近）：同文件夹已有任务型会话则激活不新建
      if (reuse) {
        const existing = state.tasks.find((t) => t.kind !== "tool" && normDir(t.dir) === proj);
        if (existing) {
          dispatch({ type: "activate", id: existing.id });
          return;
        }
      }
      const id = `sess-${taskIdFromDir(dir)}-${++seq.current}`;
      const task: Task = {
        id,
        name: dirBasename(dir),
        dir,
        status: "idle",
        source,
        assignee: null,
        external_ref: null,
        last_opened_at: now,
        created_at: now,
        kind: "task",
        project: proj,
      };
      try {
        const saved = await invoke<Task>("upsert_task", { task });
        dispatch({ type: "upsert", task: { ...saved, project: proj, kind: "task" } });
      } catch {
        dispatch({ type: "upsert", task }); // 落盘失败也先进内存
      }
    },
    [state.tasks],
  );

  // 在某项目（dir）下新开一个绑工具的会话（不落盘，运行时实例）
  const addSession = useCallback((dir: string, tool: string, name: string, startupCmd: string) => {
    const now = Date.now();
    const task: Task = {
      id: `sess-tool-${tool}-${++seq.current}`,
      name,
      dir,
      status: "running",
      source: "manual",
      assignee: null,
      external_ref: null,
      last_opened_at: now,
      created_at: now,
      tool,
      startup_cmd: startupCmd,
      kind: "tool",
      project: dir ? normDir(dir) : null,
    };
    dispatch({ type: "upsert", task });
  }, []);

  // 无项目文件夹的工具会话（运行面板点启动）
  const addToolSession = useCallback(
    (tool: string, name: string, startupCmd: string, dir?: string) => {
      addSession(dir ?? "", tool, name, startupCmd);
    },
    [addSession],
  );

  const removeTask = useCallback(async (id: string) => {
    dispatch({ type: "remove", id });
    await invoke("remove_task", { id }).catch(() => {});
  }, []);

  const activate = useCallback((id: string) => dispatch({ type: "activate", id }), []);
  const setRight = useCallback((id: string, kind: RightKind) => dispatch({ type: "setRight", id, kind }), []);
  const toggleRight = useCallback((id: string, open?: boolean) => dispatch({ type: "toggleRight", id, open }), []);
  const setRatio = useCallback((id: string, ratio: number) => dispatch({ type: "setRatio", id, ratio }), []);
  const toggleDrawer = useCallback((id: string, open?: boolean) => dispatch({ type: "toggleDrawer", id, open }), []);
  const setDrawerHeight = useCallback((id: string, h: number) => dispatch({ type: "setDrawerHeight", id, h }), []);

  return (
    <WorkbenchCtx.Provider
      value={{
        state,
        addTask,
        addSession,
        addToolSession,
        removeTask,
        activate,
        setRight,
        toggleRight,
        setRatio,
        toggleDrawer,
        setDrawerHeight,
      }}
    >
      {children}
    </WorkbenchCtx.Provider>
  );
}

export function useWorkbench(): Ctx {
  const ctx = useContext(WorkbenchCtx);
  if (!ctx) throw new Error("useWorkbench 必须在 WorkbenchProvider 内使用");
  return ctx;
}
