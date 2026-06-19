/**
 * 文件面板 —— 任务文件夹的文件树（懒加载）+ 只读预览。
 *
 * 树节点点开才请求 list_dir（单层），Map 缓存已加载层。双击文件读 read_text_file 在右侧预览。
 * 不引文件树库，纯递归组件 + Tailwind。
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";

type Entry = { name: string; path: string; is_dir: boolean; size: number };

export function FilesPanel({ root, active }: { root: string; active: boolean }) {
  // path -> 该目录的子项（已加载）
  const [cache, setCache] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [loadedRoot, setLoadedRoot] = useState(false);

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
        if (next.has(e.path)) {
          next.delete(e.path);
        } else {
          next.add(e.path);
          if (!cache[e.path]) void load(e.path);
        }
        return next;
      });
    },
    [cache, load],
  );

  const openFile = useCallback(async (e: Entry) => {
    try {
      const text = await invoke<string>("read_text_file", { path: e.path, maxBytes: null });
      setPreview({ path: e.path, text });
    } catch (err) {
      setPreview({ path: e.path, text: `[无法预览: ${String(err)}]` });
    }
  }, []);

  return (
    <div className="flex h-full min-h-0">
      {/* 树 */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-white/[0.06] min-h-0">
        <div className="flex items-center justify-between h-8 px-3 border-b border-white/[0.06] shrink-0">
          <span className="text-[11px] text-ink-3 truncate font-mono" title={root}>
            {root}
          </span>
          <button
            onClick={() => void load(root)}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-ink-4 hover:text-ink-1 hover:bg-white/[0.06] shrink-0"
            title="刷新"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1 text-[12.5px]">
          <Tree
            dir={root}
            depth={0}
            cache={cache}
            expanded={expanded}
            onToggle={toggle}
            onOpen={openFile}
            activePath={preview?.path ?? null}
          />
        </div>
      </div>

      {/* 预览 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {preview ? (
          <>
            <div className="h-8 px-3 flex items-center border-b border-white/[0.06] shrink-0 text-[11px] text-ink-3 font-mono truncate">
              {preview.path}
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[12px] leading-relaxed text-ink-2 font-mono whitespace-pre-wrap">
              {preview.text}
            </pre>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-ink-4 text-[12px]">
            双击文件预览
          </div>
        )}
      </div>
    </div>
  );
}

function Tree({
  dir,
  depth,
  cache,
  expanded,
  onToggle,
  onOpen,
  activePath,
}: {
  dir: string;
  depth: number;
  cache: Record<string, Entry[]>;
  expanded: Set<string>;
  onToggle: (e: Entry) => void;
  onOpen: (e: Entry) => void;
  activePath: string | null;
}) {
  const items = cache[dir];
  if (!items) return null;
  return (
    <>
      {items.map((e) => {
        const isOpen = expanded.has(e.path);
        const on = activePath === e.path;
        return (
          <div key={e.path}>
            <div
              onClick={() => (e.is_dir ? onToggle(e) : onOpen(e))}
              onDoubleClick={() => !e.is_dir && onOpen(e)}
              className={
                "flex items-center gap-1 h-6 pr-2 cursor-pointer rounded-sm " +
                (on ? "bg-accent/[0.12] text-ink-0" : "text-ink-2 hover:bg-white/[0.04]")
              }
              style={{ paddingLeft: 8 + depth * 12 }}
              title={e.name}
            >
              {e.is_dir ? (
                <>
                  {isOpen ? <ChevronDown size={12} className="shrink-0 text-ink-4" /> : <ChevronRight size={12} className="shrink-0 text-ink-4" />}
                  {isOpen ? <FolderOpen size={13} className="shrink-0 text-accent-400" /> : <Folder size={13} className="shrink-0 text-ink-3" />}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <FileIcon size={13} className="shrink-0 text-ink-4" />
                </>
              )}
              <span className="truncate">{e.name}</span>
            </div>
            {e.is_dir && isOpen && (
              <Tree
                dir={e.path}
                depth={depth + 1}
                cache={cache}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
                activePath={activePath}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
