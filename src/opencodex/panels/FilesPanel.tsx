/**
 * 文件面板 —— 任务文件夹的文件树（懒加载）+ 预览标注 + 常用文件操作。
 *
 * 树节点点开才请求 list_dir（单层）。右键弹上下文菜单：新建文件/文件夹、重命名、
 * 删除（进回收站，可恢复）、复制/剪切/粘贴、复制路径、在资源管理器中显示、用默认程序打开。
 * 预览+标注交给 redline-core 的 RedlinePanel（PDF/Word/Excel/PSD/3D/CAD/ZIP……通用），
 * 本文件只负责把 Tauri 能力（读字节/kv 存标注/写终端/打开外部程序）接成 RedlineHost。
 * 不引文件树库，纯递归组件 + Tailwind（守体积红线）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { RedlinePanel } from "redline-core";
import { createTauriRedlineHost } from "../redline-host-tauri";

type Entry = { name: string; path: string; is_dir: boolean; size: number };
type Clip = { path: string; name: string; cut: boolean };
type Menu = { x: number; y: number; entry: Entry | null };
type Pending = { parentDir: string; isDir: boolean };

const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");
const joinPath = (dir: string, name: string) => {
  const s = sepOf(dir);
  return dir.endsWith(s) ? dir + name : dir + s + name;
};
const parentOf = (p: string) => {
  const s = sepOf(p);
  const t = p.endsWith(s) ? p.slice(0, -1) : p;
  const i = t.lastIndexOf(s);
  return i > 0 ? t.slice(0, i) : t;
};

/** 树 + 操作共享的上下文（打包传递，少写 props）。 */
type TreeCtx = {
  cache: Record<string, Entry[]>;
  expanded: Set<string>;
  activePath: string | null;
  renaming: string | null;
  pending: Pending | null;
  onToggle: (e: Entry) => void;
  onOpen: (e: Entry) => void;
  onContext: (ev: React.MouseEvent, entry: Entry | null) => void;
  commitRename: (e: Entry, name: string) => void;
  cancelRename: () => void;
  commitCreate: (name: string) => void;
  cancelCreate: () => void;
};

export function FilesPanel({
  root,
  active,
  pasteToTerminal,
}: {
  root: string;
  active: boolean;
  /** Redline「发给终端」按钮用：把标注文字写进主区最后一个终端格（不回车）。 */
  pasteToTerminal: (text: string) => void;
}) {
  const [cache, setCache] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadedRoot, setLoadedRoot] = useState(false);
  // pasteToTerminal 引用稳定（SplitArea 里已经 useCallback 过），host 只在它变化时重建，
  // 不会每次渲染都触发 RedlinePanel 重新拉字节。
  const redlineHost = useMemo(() => createTauriRedlineHost(pasteToTerminal), [pasteToTerminal]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const flash = useCallback((m: string) => {
    setErr(m);
    window.setTimeout(() => setErr((cur) => (cur === m ? null : cur)), 3500);
  }, []);

  const load = useCallback(async (dir: string) => {
    try {
      const list = await invoke<Entry[]>("list_dir", { path: dir, showNoise: false });
      setCache((c) => ({ ...c, [dir]: list }));
    } catch {
      setCache((c) => ({ ...c, [dir]: [] }));
    }
  }, []);

  // 首次激活时加载根
  useEffect(() => {
    if (active && !loadedRoot) {
      setLoadedRoot(true);
      void load(root);
    }
  }, [active, loadedRoot, root, load]);

  const toggle = useCallback(
    (e: Entry) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(e.path)) next.delete(e.path);
        else {
          next.add(e.path);
          if (!cache[e.path]) void load(e.path);
        }
        return next;
      });
    },
    [cache, load],
  );

  // 格式识别/渲染/标注全交给 RedlinePanel，这里只记路径。
  const openFile = useCallback((e: Entry) => {
    setActivePath(e.path);
  }, []);

  // ---- 文件操作 ----
  const ensureExpanded = useCallback(
    (dir: string) => {
      if (dir === root) return;
      setExpanded((prev) => {
        if (prev.has(dir)) return prev;
        const next = new Set(prev);
        next.add(dir);
        return next;
      });
      if (!cache[dir]) void load(dir);
    },
    [root, cache, load],
  );

  const startCreate = useCallback(
    (parentDir: string, isDir: boolean) => {
      ensureExpanded(parentDir);
      setPending({ parentDir, isDir });
    },
    [ensureExpanded],
  );

  const commitCreate = useCallback(
    async (name: string) => {
      if (!pending) return;
      const { parentDir, isDir } = pending;
      setPending(null);
      const target = joinPath(parentDir, name);
      try {
        await invoke(isDir ? "create_dir" : "create_file", { path: target });
        await load(parentDir);
      } catch (e) {
        flash(String(e));
      }
    },
    [pending, load, flash],
  );

  const commitRename = useCallback(
    async (e: Entry, name: string) => {
      setRenaming(null);
      if (name === e.name) return;
      const to = joinPath(parentOf(e.path), name);
      try {
        await invoke("rename_path", { from: e.path, to });
        await load(parentOf(e.path));
        setActivePath((p) => (p === e.path ? null : p));
      } catch (er) {
        flash(String(er));
      }
    },
    [load, flash],
  );

  const del = useCallback(
    async (e: Entry) => {
      const ok = await ask(`Delete "${e.name}"? It will be moved to the Recycle Bin and can be restored.`, {
        title: "Delete",
        kind: "warning",
      });
      if (!ok) return;
      try {
        await invoke("delete_path", { path: e.path });
        await load(parentOf(e.path));
        setActivePath((p) => (p === e.path ? null : p));
      } catch (er) {
        flash(String(er));
      }
    },
    [load, flash],
  );

  const paste = useCallback(
    async (targetDir: string) => {
      if (!clip) return;
      const to = joinPath(targetDir, clip.name);
      try {
        await invoke(clip.cut ? "rename_path" : "copy_path", { from: clip.path, to });
        await load(targetDir);
        if (clip.cut) {
          await load(parentOf(clip.path));
          setClip(null);
        }
      } catch (er) {
        flash(String(er));
      }
    },
    [clip, load, flash],
  );

  const refresh = useCallback(() => {
    void load(root);
    expanded.forEach((d) => void load(d));
  }, [load, root, expanded]);

  // 上下文菜单项
  const targetDirOf = (entry: Entry | null) =>
    entry ? (entry.is_dir ? entry.path : parentOf(entry.path)) : root;

  const ctx: TreeCtx = {
    cache,
    expanded,
    activePath,
    renaming,
    pending,
    onToggle: toggle,
    onOpen: openFile,
    onContext: (ev, entry) => {
      ev.preventDefault();
      ev.stopPropagation();
      setMenu({ x: ev.clientX, y: ev.clientY, entry });
    },
    commitRename,
    cancelRename: () => setRenaming(null),
    commitCreate,
    cancelCreate: () => setPending(null),
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 树 */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-white/[0.06] min-h-0">
        <div className="flex items-center gap-1 h-8 px-3 border-b border-white/[0.06] shrink-0">
          <span className="text-[11px] text-ink-3 truncate font-mono flex-1" title={root}>
            {root}
          </span>
          <button
            onClick={() => startCreate(root, false)}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06] shrink-0"
            title="New file"
          >
            <FilePlus size={12} />
          </button>
          <button
            onClick={() => startCreate(root, true)}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06] shrink-0"
            title="New folder"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06] shrink-0"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto py-1 text-[12.5px]"
          onContextMenu={(e) => ctx.onContext(e, null)}
        >
          <Tree dir={root} depth={0} ctx={ctx} />
        </div>
        {err && (
          <div className="shrink-0 px-3 py-1.5 text-[11px] text-danger-400 border-t border-white/[0.06] truncate" title={err}>
            {err}
          </div>
        )}
      </div>

      {/* 预览 + 标注（Redline） */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {activePath ? (
          <>
            <div className="h-8 px-3 flex items-center gap-2 border-b border-white/[0.06] shrink-0 text-[11px] text-ink-3 font-mono">
              <span className="truncate flex-1" title={activePath}>
                {activePath}
              </span>
              <button
                onClick={() => void invoke("open_path", { path: activePath })}
                className="inline-flex items-center gap-1 shrink-0 px-1.5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06]"
                title="Open with default app"
              >
                <ExternalLink size={11} /> Open
              </button>
            </div>
            <RedlinePanel
              key={activePath}
              host={redlineHost}
              path={activePath}
              fileName={activePath.split(sepOf(activePath)).pop() ?? activePath}
            />
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-ink-4 text-[12px]">
            Click a file to preview · right-click to manage
          </div>
        )}
      </div>

      {/* 上下文菜单 */}
      {menu && (
        <ContextMenu
          menu={menu}
          clip={clip}
          onClose={() => setMenu(null)}
          onNewFile={() => startCreate(targetDirOf(menu.entry), false)}
          onNewFolder={() => startCreate(targetDirOf(menu.entry), true)}
          onOpen={() => menu.entry && !menu.entry.is_dir && void openFile(menu.entry)}
          onRename={() => menu.entry && setRenaming(menu.entry.path)}
          onDelete={() => menu.entry && void del(menu.entry)}
          onCopy={() =>
            menu.entry && setClip({ path: menu.entry.path, name: menu.entry.name, cut: false })
          }
          onCut={() =>
            menu.entry && setClip({ path: menu.entry.path, name: menu.entry.name, cut: true })
          }
          onPaste={() => void paste(targetDirOf(menu.entry))}
          onCopyPath={() =>
            menu.entry && void invoke("clipboard_write", { text: menu.entry.path })
          }
          onReveal={() =>
            menu.entry && void invoke("reveal_in_file_manager", { path: menu.entry.path })
          }
          onOpenExternal={() =>
            menu.entry && void invoke("open_path", { path: menu.entry.path })
          }
        />
      )}
    </div>
  );
}

function Tree({ dir, depth, ctx }: { dir: string; depth: number; ctx: TreeCtx }) {
  const items = ctx.cache[dir];
  const showCreate = ctx.pending?.parentDir === dir;
  if (!items && !showCreate) return null;
  return (
    <>
      {showCreate && (
        <div className="flex items-center gap-1 h-6 pr-2" style={{ paddingLeft: 8 + depth * 12 }}>
          <span className="w-3 shrink-0" />
          {ctx.pending!.isDir ? (
            <Folder size={13} className="shrink-0 text-accent-400" />
          ) : (
            <FileIcon size={13} className="shrink-0 text-ink-4" />
          )}
          <EditInput initial="" onCommit={ctx.commitCreate} onCancel={ctx.cancelCreate} />
        </div>
      )}
      {(items ?? []).map((e) => {
        const isOpen = ctx.expanded.has(e.path);
        const on = ctx.activePath === e.path;
        const isRenaming = ctx.renaming === e.path;
        return (
          <div key={e.path}>
            <div
              onClick={() => (e.is_dir ? ctx.onToggle(e) : ctx.onOpen(e))}
              onContextMenu={(ev) => ctx.onContext(ev, e)}
              className={
                "flex items-center gap-1 h-6 pr-2 cursor-pointer rounded-sm " +
                (on ? "bg-accent/[0.12] text-ink-0" : "text-ink-2 hover:bg-white/[0.04]")
              }
              style={{ paddingLeft: 8 + depth * 12 }}
              title={e.name}
            >
              {e.is_dir ? (
                <>
                  {isOpen ? (
                    <ChevronDown size={12} className="shrink-0 text-ink-4" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0 text-ink-4" />
                  )}
                  {isOpen ? (
                    <FolderOpen size={13} className="shrink-0 text-accent-400" />
                  ) : (
                    <Folder size={13} className="shrink-0 text-ink-3" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <FileIcon size={13} className="shrink-0 text-ink-4" />
                </>
              )}
              {isRenaming ? (
                <EditInput
                  initial={e.name}
                  onCommit={(name) => ctx.commitRename(e, name)}
                  onCancel={ctx.cancelRename}
                />
              ) : (
                <span className="truncate">{e.name}</span>
              )}
            </div>
            {e.is_dir && isOpen && <Tree dir={e.path} depth={depth + 1} ctx={ctx} />}
          </div>
        );
      })}
    </>
  );
}

/** 内联输入框（新建 / 重命名共用）。Enter 提交、Esc / 空取消、失焦提交。 */
function EditInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const commit = () => {
    if (done.current) return;
    const t = v.trim();
    done.current = true;
    t ? onCommit(t) : onCancel();
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 bg-bg-1 border border-accent/60 rounded px-1 py-0 text-[12px] text-ink-0 outline-none"
    />
  );
}

/** 右键上下文菜单。fixed 定位到点击处，点空白 / Esc 关闭。 */
function ContextMenu({
  menu,
  clip,
  onClose,
  onNewFile,
  onNewFolder,
  onOpen,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onPaste,
  onCopyPath,
  onReveal,
  onOpenExternal,
}: {
  menu: Menu;
  clip: Clip | null;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onCopyPath: () => void;
  onReveal: () => void;
  onOpenExternal: () => void;
}) {
  const e = menu.entry;
  const isFile = !!e && !e.is_dir;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  // 视口内钳制，避免菜单溢出
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 340),
  };
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(ev) => { ev.preventDefault(); onClose(); }} />
      <div
        style={style}
        className="fixed z-50 min-w-[176px] py-1 rounded-lg border border-white/[0.10] bg-bg-2 shadow-xl text-[12.5px] text-ink-1"
      >
        {isFile && <Item label="Preview" onClick={run(onOpen)} />}
        {isFile && <Item label="Open with default app" onClick={run(onOpenExternal)} />}
        {isFile && <Sep />}
        <Item label="New file" onClick={run(onNewFile)} />
        <Item label="New folder" onClick={run(onNewFolder)} />
        {e && <Sep />}
        {e && <Item label="Rename" onClick={run(onRename)} />}
        {e && <Item label="Delete (to Recycle Bin)" danger onClick={run(onDelete)} />}
        {e && <Sep />}
        {e && <Item label="Copy" onClick={run(onCopy)} />}
        {e && <Item label="Cut" onClick={run(onCut)} />}
        {clip && <Item label={`Paste "${clip.name}"`} onClick={run(onPaste)} />}
        {e && <Sep />}
        {e && <Item label="Copy path" onClick={run(onCopyPath)} />}
        {e && <Item label="Show in File Explorer" onClick={run(onReveal)} />}
      </div>
    </>
  );
}

function Item({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        "w-full text-left px-3 py-1.5 hover:bg-white/[0.06] " +
        (danger ? "text-danger-400" : "text-ink-1")
      }
    >
      {label}
    </button>
  );
}

function Sep() {
  return <div className="my-1 border-t border-white/[0.06]" />;
}
