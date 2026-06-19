/**
 * 终端分屏容器 —— 把右侧终端区拆成左右/上下多格，每格一个独立终端 group。
 *
 * 用于「claude code 平行多开几个窗口」：每个叶子格挂一个 TermPanel（内含独立 useTermGroup，
 * seqRef 实例内化，多格零冲突）。分屏树是二叉树，纯内存不落盘。分隔条原生 mousemove 拖动，
 * 不引 react-resizable/allotment（守体积红线）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
// (useRef 已用于分隔条拖动 + firstPaneId)
import { Columns2, Rows2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { TermPanel } from "../panels/TermPanel";

type Pane = { kind: "pane"; id: number };
type Split = { kind: "split"; dir: "row" | "col"; ratio: number; a: Node; b: Node };
type Node = Pane | Split;

/** 落盘用的「形状」：去掉 pane.id（恢复时重新发号），只留分屏结构 + 比例。 */
type ShapePane = { kind: "pane" };
type ShapeSplit = { kind: "split"; dir: "row" | "col"; ratio: number; a: ShapeNode; b: ShapeNode };
type ShapeNode = ShapePane | ShapeSplit;

/** 运行时树 → 落盘形状（抹掉 id）。 */
function toShape(node: Node): ShapeNode {
  if (node.kind === "pane") return { kind: "pane" };
  return { kind: "split", dir: node.dir, ratio: node.ratio, a: toShape(node.a), b: toShape(node.b) };
}

/** 命令式接口：透给 SidePanel 标题栏的「分屏」按钮，对最后一个叶子格分屏。 */
export type SplitApi = { splitLast: (dir: "row" | "col") => void };

export function SplitContainer({
  cwd,
  active,
  tool,
  initialCmd,
  storageKey,
  onReady,
}: {
  cwd: string;
  active: boolean;
  tool?: string;
  initialCmd?: string;
  /** 传了就把分屏布局形状落盘（key 通常用 task.id），关 App 重开恢复格子排布。 */
  storageKey?: string;
  onReady?: (api: SplitApi) => void;
}) {
  // pane 序号实例内化（每个 SplitContainer 独立计数，左右两侧多实例不撞 React key）
  const paneSeqRef = useRef(0);
  const newPane = useCallback((): Pane => ({ kind: "pane", id: ++paneSeqRef.current }), []);
  const [root, setRoot] = useState<Node>(() => ({ kind: "pane", id: ++paneSeqRef.current }) as Node);
  // initialCmd 只给最初那个 pane（分屏新增的不再重复跑启动命令）
  const firstPaneId = useRef<number | null>(null);
  if (firstPaneId.current === null && root.kind === "pane") firstPaneId.current = root.id;

  // —— 布局持久化（只存形状，不存 pane id / 进程内容）——
  const restoredRef = useRef(false);
  const reseqTree = useCallback((shape: ShapeNode): Node => {
    if (shape.kind === "split")
      return { kind: "split", dir: shape.dir, ratio: shape.ratio, a: reseqTree(shape.a), b: reseqTree(shape.b) };
    return { kind: "pane", id: ++paneSeqRef.current };
  }, []);
  // 挂载时恢复（异步；恢复出多格则 firstPaneId 失效→initialCmd 不重跑，符合"进程是新起的"语义）
  useEffect(() => {
    if (!storageKey || restoredRef.current) return;
    restoredRef.current = true;
    void invoke<string | null>("kv_get", { key: `term_layout:${storageKey}` })
      .then((s) => {
        if (!s) return;
        const shape = JSON.parse(s) as ShapeNode;
        if (shape.kind === "split") {
          const tree = reseqTree(shape);
          setRoot(tree);
          firstPaneId.current = -1; // 恢复出分屏 → 没有"首格"，initialCmd 不再下发
        }
      })
      .catch(() => {});
  }, [storageKey, reseqTree]);
  // 树变化时存形状（防抖到下一帧，避免连续分屏多次写盘）
  useEffect(() => {
    if (!storageKey || !restoredRef.current) return;
    const id = setTimeout(() => {
      const shape = toShape(root);
      void invoke("kv_set", { key: `term_layout:${storageKey}`, value: JSON.stringify(shape) }).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [root, storageKey]);

  // 把某个 pane 拆成 split（在它原位放一个新 split，含原 pane + 新 pane）
  const splitPane = useCallback((targetId: number, dir: "row" | "col") => {
    setRoot((r) => transform(r, targetId, (p) => ({ kind: "split", dir, ratio: 0.5, a: p, b: newPane() })));
  }, [newPane]);

  // 对「最后一个叶子格」分屏 —— SidePanel 标题栏按钮用（不必先 hover 某格）
  const splitLast = useCallback((dir: "row" | "col") => {
    setRoot((r) => {
      const id = lastPaneId(r);
      return transform(r, id, (p) => ({ kind: "split", dir, ratio: 0.5, a: p, b: newPane() }));
    });
  }, [newPane]);

  // 透出命令式接口给父级
  useEffect(() => {
    onReady?.({ splitLast });
  }, [onReady, splitLast]);

  // 关闭某个 pane（用兄弟节点替换它的父 split）
  const closePane = useCallback((targetId: number) => {
    setRoot((r) => {
      if (r.kind === "pane") return r; // 只剩一个不关
      return removePane(r, targetId) ?? r;
    });
  }, []);

  // 按路径调分隔条比例（路径 = 从根到该 split 的 'a'/'b' 序列，节点引用在不可变更新后会变，
  // 路径稳定）
  const setRatioByPath = useCallback((path: string, ratio: number) => {
    setRoot((r) => updateRatioByPath(r, path, "", Math.min(0.85, Math.max(0.15, ratio))));
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const rects = layoutRects(root);
  const splitsCount = rects.bars.length;

  return (
    <div ref={containerRef} className="relative h-full min-h-0 min-w-0 overflow-hidden">
      {/* 所有 TermPanel 平铺在同一父容器、绝对定位到各自矩形 —— key=paneId 稳定，
          分屏只改 style 不改 DOM 层级 → PTY 永不重建（关键修复：以前嵌在递归树里，
          一分屏 TermPanel 就换挂载点被卸载，正在跑 claude 的终端就被杀了）。 */}
      {rects.panes.map((pr) => (
        <div
          key={pr.id}
          className="absolute"
          style={{ left: `${pr.left}%`, top: `${pr.top}%`, width: `${pr.width}%`, height: `${pr.height}%` }}
        >
          <div className="relative h-full min-h-0 min-w-0">
            {/* 每格右上角：拆分 / 关闭 */}
            <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
              <button
                onClick={() => splitPane(pr.id, "row")}
                title="左右分屏（再开一个终端）"
                className="w-7 h-7 rounded-md bg-bg-2/95 border border-white/[0.12] flex items-center justify-center text-ink-2 hover:text-white hover:bg-accent/[0.30] hover:border-accent/50"
              >
                <Columns2 size={13} />
              </button>
              <button
                onClick={() => splitPane(pr.id, "col")}
                title="上下分屏（再开一个终端）"
                className="w-7 h-7 rounded-md bg-bg-2/95 border border-white/[0.12] flex items-center justify-center text-ink-2 hover:text-white hover:bg-accent/[0.30] hover:border-accent/50"
              >
                <Rows2 size={13} />
              </button>
              {splitsCount > 0 && (
                <button
                  onClick={() => closePane(pr.id)}
                  title="关闭此格"
                  className="w-7 h-7 rounded-md bg-bg-2/95 border border-white/[0.12] flex items-center justify-center text-ink-2 hover:text-danger-400 hover:bg-white/[0.08]"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <TermPanel
              cwd={cwd}
              active={active}
              tool={tool}
              initialCmd={pr.id === firstPaneId.current ? initialCmd : undefined}
            />
          </div>
        </div>
      ))}
      {/* 分隔条层：每条对应一个 split，拖动改它的 ratio */}
      {rects.bars.map((bar) => (
        <SplitBar key={bar.path} bar={bar} containerRef={containerRef} onRatio={setRatioByPath} />
      ))}
    </div>
  );
}

/* ---- 布局：分屏树 → 每个 pane 的百分比矩形 + 每条分隔条（含其父区域范围）---- */

type PaneRect = { id: number; left: number; top: number; width: number; height: number };
type BarRect = {
  path: string; // 该 split 的稳定路径（根到此的 a/b 序列）
  dir: "row" | "col";
  left: number;
  top: number;
  width: number;
  height: number;
  // 该 split 占据的父区域（拖动时按此换算 ratio）
  px: number;
  py: number;
  pw: number;
  ph: number;
};
type Layout = { panes: PaneRect[]; bars: BarRect[] };

const BAR = 0.5; // 分隔条粗细（百分比，细线）

function layoutRects(node: Node): Layout {
  const panes: PaneRect[] = [];
  const bars: BarRect[] = [];
  const walk = (n: Node, left: number, top: number, width: number, height: number, path: string) => {
    if (n.kind === "pane") {
      panes.push({ id: n.id, left, top, width, height });
      return;
    }
    if (n.dir === "row") {
      const aw = width * n.ratio;
      walk(n.a, left, top, aw, height, path + "a");
      walk(n.b, left + aw, top, width - aw, height, path + "b");
      bars.push({ path, dir: "row", left: left + aw - BAR / 2, top, width: BAR, height, px: left, py: top, pw: width, ph: height });
    } else {
      const ah = height * n.ratio;
      walk(n.a, left, top, width, ah, path + "a");
      walk(n.b, left, top + ah, width, height - ah, path + "b");
      bars.push({ path, dir: "col", left, top: top + ah - BAR / 2, width, height: BAR, px: left, py: top, pw: width, ph: height });
    }
  };
  walk(node, 0, 0, 100, 100, "");
  return { panes, bars };
}

/** 分隔条：绝对定位，拖动按其父区域范围换算出新 ratio，回调按 path 更新。 */
function SplitBar({
  bar,
  containerRef,
  onRatio,
}: {
  bar: BarRect;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onRatio: (path: string, ratio: number) => void;
}) {
  const isRow = bar.dir === "row";
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const move = (ev: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      if (isRow) {
        const px = ((ev.clientX - rect.left) / rect.width) * 100; // 容器内 % 横坐标
        onRatio(bar.path, (px - bar.px) / bar.pw); // 相对父区域起点/宽度
      } else {
        const py = ((ev.clientY - rect.top) / rect.height) * 100;
        onRatio(bar.path, (py - bar.py) / bar.ph);
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      onMouseDown={onDown}
      className={
        "absolute z-[5] bg-white/[0.06] hover:bg-accent/60 transition-colors " +
        (isRow ? "cursor-col-resize" : "cursor-row-resize")
      }
      style={{ left: `${bar.left}%`, top: `${bar.top}%`, width: `${bar.width}%`, height: `${bar.height}%` }}
    />
  );
}

/** 按路径更新某 split 的 ratio（cur 是已走过的路径前缀）。 */
function updateRatioByPath(node: Node, target: string, cur: string, ratio: number): Node {
  if (node.kind === "pane") return node;
  if (cur === target) return { ...node, ratio };
  return {
    ...node,
    a: updateRatioByPath(node.a, target, cur + "a", ratio),
    b: updateRatioByPath(node.b, target, cur + "b", ratio),
  };
}

/* ---- 树操作（纯函数，不可变更新）---- */

// 最后一个（最右下）叶子格 id —— 一路走 b 分支到底
function lastPaneId(node: Node): number {
  return node.kind === "pane" ? node.id : lastPaneId(node.b);
}

// 把满足 id 的 pane 替换成 fn(pane) 的结果
function transform(node: Node, id: number, fn: (p: Pane) => Node): Node {
  if (node.kind === "pane") return node.id === id ? fn(node) : node;
  return { ...node, a: transform(node.a, id, fn), b: transform(node.b, id, fn) };
}

// 移除 id 对应的 pane：找到它的父 split，用兄弟替换；返回新树或 null（没找到）
function removePane(node: Node, id: number): Node | null {
  if (node.kind === "pane") return null;
  // 直接子是目标 pane → 返回兄弟
  if (node.a.kind === "pane" && node.a.id === id) return node.b;
  if (node.b.kind === "pane" && node.b.id === id) return node.a;
  // 递归
  const a = removePane(node.a, id);
  if (a) return { ...node, a };
  const b = removePane(node.b, id);
  if (b) return { ...node, b };
  return null;
}

