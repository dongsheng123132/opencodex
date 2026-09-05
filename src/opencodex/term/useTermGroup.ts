/**
 * useTermGroup —— 一组终端会话的管理引擎（从 Terminal.tsx 抽出，复用）。
 *
 * 一个 group = 一个 host 容器里多个 xterm 标签，每个标签一个独立 PTY 会话。
 * 独立终端页（TerminalPage）、工作台每个任务的终端面板（TermPanel）、TUI 应用页各持有一个 group，
 * 互不污染。切标签/隐藏 group 只切 display，不杀 PTY（openclaw gateway 等长跑进程续命）。
 *
 * 与原 Terminal.tsx 的两点差异（计划要求）：
 *  1. ensurePty 传 cwd —— 工作台按任务文件夹开终端（cwd 为空 → 后端回落 home，抽屉行为不变）
 *  2. 终端序号 seq 改成实例内 useRef —— 多任务/多 group 不再共用模块级全局，避免 key 撞
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

// 软重置序列 —— 把终端各种「上报/屏幕」私有模式打回默认。专治 claude/codex 等 TUI 崩溃/被杀后
// 没机会清理留下的卡死状态:鼠标坐标乱码、备用屏花屏、括号粘贴异常、光标消失、方向键错乱。
// 只写进 xterm 的解析流（重置模拟器自身状态），不碰 PTY/shell，也不清空回滚历史 → 零副作用。
const SOFT_RESET_SEQ =
  "\x1b[!p" + // DECSTR 软复位:光标键(DECCKM)/原点/插入/滚动区/SGR 等一把回默认
  "\x1b[?7h" + // 自动换行开(默认;以防 TUI 关了它崩溃没恢复)
  "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l" + // 各种鼠标上报关(DECSTR 不管)
  "\x1b[?1004l" + // 焦点上报关(和 onData 出口的吞噬双保险)
  "\x1b[?2004l" + // 括号粘贴关
  "\x1b[?1049l" + // 退出备用屏 → 回主缓冲(治花屏)
  "\x1b[?25h"; // 显示光标(TUI 崩溃常把光标藏了)

type TermSession = {
  key: number;
  title: string;
  term: XTerm;
  fit: FitAddon;
  sessionId: string | null; // 后端 PTY id（懒启动后填）
  el: HTMLDivElement; // 该终端容器（一直存在，靠 display 切换）
  disposed: boolean; // 已关闭标记：异步 init（setTimeout/ensurePty）回来前若已关，跳过别写已 dispose 的 xterm
  lastCols: number; // 上次发给后端 PTY 的 cols/rows —— 尺寸没真变就不再发，杜绝无谓 SIGWINCH 重绘
  lastRows: number;
  lastCommand: string | null;
  pendingInput: string;
};

export type TermGroup = {
  /** 宿主容器 ref —— 调用方挂到面板/抽屉的终端区 */
  hostRef: React.RefObject<HTMLDivElement | null>;
  tabs: { key: number; title: string }[];
  activeKey: number | null;
  setActiveKey: (k: number) => void;
  newTerm: () => TermSession | undefined;
  closeTerm: (key: number) => void;
  /** 在当前激活终端（没有则新建）跑一条命令 */
  runInActive: (cmd: string) => void;
  /** 往当前激活终端写入原始文本（不回车）——拖放落路径用，光标停在文本后，用户可继续打字 */
  pasteToActive: (text: string) => void;
  /** 当前终端字号 */
  fontSize: number;
  /** 调字号（delta 正负）：应用到本 group 所有终端 + 存盘 */
  bumpFontSize: (delta: number) => void;
  /** 软重置当前终端：清掉 TUI 崩溃残留的卡死模式（鼠标乱码/花屏/光标消失等），不清屏不碰 shell */
  resetActive: () => void;
  /** 当前标签最后一次由工作台快捷启动的命令 */
  activeCommand: string | null;
};

/**
 * @param open  group 是否可见（抽屉展开 / 任务激活）。用于 fit + 懒建首个终端。
 * @param cwd   终端工作目录（任务文件夹）；undefined → 后端回落 home。
 * @param pendingCmd 待运行命令（点工具「打开终端」塞进来）；运行后调 onConsumedCmd 清空。
 */
export function useTermGroup(opts: {
  open: boolean;
  cwd?: string;
  /** 给本 group 的 PTY 打工具 tag（claude/openclaw…），运行面板 list_running 据此识别 */
  tool?: string;
  /** 首个终端自动跑的启动命令（工具型会话用，如 "openclaw gateway run"）。过后端白名单。 */
  initialCmd?: string;
  pendingCmd?: string | null;
  onConsumedCmd?: () => void;
}): TermGroup {
  const { open, cwd, tool, initialCmd, pendingCmd, onConsumedCmd } = opts;
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<TermSession[]>([]);
  const seqRef = useRef(0); // 实例内序号，不共用模块全局
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // 启动命令只在首个终端下发一次
  const initialCmdRef = useRef(initialCmd);
  const initialFiredRef = useRef(false);
  // 终端字号（默认 14；全局共享，落盘 kv "term_font_size"，所有终端统一）
  const fontSizeRef = useRef(14);
  const [fontSize, setFontSizeState] = useState(14);
  const [tabs, setTabs] = useState<{ key: number; title: string }[]>([]);
  const [activeKey, setActiveKeyState] = useState<number | null>(null);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const activeKeyRef = useRef<number | null>(null);
  activeKeyRef.current = activeKey;

  // 用户主动点标签切终端：切过去 + 给焦点（被动重渲染走 setActiveKeyState 不会到这）
  const setActiveKey = useCallback((k: number) => {
    setActiveKeyState(k);
    setActiveCommand(sessionsRef.current.find((x) => x.key === k)?.lastCommand ?? null);
    // 切到的终端立即拿焦点（用户意图明确）；下一帧等 display 切完再 focus
    requestAnimationFrame(() => {
      sessionsRef.current.find((x) => x.key === k)?.term.focus();
    });
  }, []);

  // 统一防抖 fit：activeKey 切换 / 容器尺寸变化 / open 切换都走这一个入口，
  // 用 rAF 合并同一帧内的多次触发 —— 杜绝「三处各自 setTimeout fit 叠加重算」的抖动。
  const rafRef = useRef<number | null>(null);
  const fitActive = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const s = sessionsRef.current.find((x) => x.key === activeKeyRef.current);
      if (!s) return;
      try {
        // 先算目标尺寸；和当前 term 尺寸一致就整个跳过 —— 不 fit、不 resize。
        // 否则 React 重渲染/style 重设引起的无谓 fit 会 reflow xterm + 给 PTY 连发
        // SIGWINCH，让 claude code 反复重绘整屏 → 打字被打断、输入行闪/错位。
        const dims = s.fit.proposeDimensions();
        if (!dims) return;
        if (dims.cols === s.term.cols && dims.rows === s.term.rows) return; // 尺寸没变，啥也不做
        s.fit.fit();
        if (s.sessionId && (s.term.cols !== s.lastCols || s.term.rows !== s.lastRows)) {
          s.lastCols = s.term.cols;
          s.lastRows = s.term.rows;
          invoke("term_resize", { sessionId: s.sessionId, cols: s.term.cols, rows: s.term.rows }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  // 加载持久化字号（一次）
  useEffect(() => {
    void invoke<string | null>("kv_get", { key: "term_font_size" })
      .then((v) => {
        const n = v ? parseInt(v, 10) : NaN;
        if (!isNaN(n) && n >= 9 && n <= 28) {
          fontSizeRef.current = n;
          setFontSizeState(n);
          for (const s of sessionsRef.current) s.term.options.fontSize = n;
          fitActive();
        }
      })
      .catch(() => {});
  }, [fitActive]);

  // 调字号（delta 正负，或绝对值）：应用到本 group 所有终端 + 存盘 + 重 fit
  const bumpFontSize = useCallback(
    (delta: number) => {
      const next = Math.min(28, Math.max(9, fontSizeRef.current + delta));
      if (next === fontSizeRef.current) return;
      fontSizeRef.current = next;
      setFontSizeState(next);
      for (const s of sessionsRef.current) {
        s.term.options.fontSize = next;
        s.lastCols = -1; // 强制下次 fit 重算（字号变了行列数会变）
      }
      void invoke("kv_set", { key: "term_font_size", value: String(next) }).catch(() => {});
      fitActive();
    },
    [fitActive],
  );

  // 起一个 PTY（懒启动）。返回 sessionId。
  const ensurePty = useCallback(async (s: TermSession): Promise<string | null> => {
    if (s.sessionId) return s.sessionId;
    try {
      const onData = new Channel<number[]>();
      onData.onmessage = (bytes) =>
        s.term.write(new Uint8Array(bytes), () => {
          // 写完回调里滚到底：claude 行式输出时确保最新内容可见。
          // xterm 默认输出跟随到底，但容器/尺寸边界情况下偶尔卡住（要 resize 才出现）——
          // 这里兜底。若用户正往上翻历史（不在最底），不强拉，尊重阅读位置。
          const buf = s.term.buffer.active;
          const atBottom = buf.viewportY >= buf.baseY - 1;
          if (atBottom) s.term.scrollToBottom();
        });
      // 启动命令只给本 group 的第一个 PTY 下发一次
      let initCmd: string | null = null;
      if (initialCmdRef.current && !initialFiredRef.current) {
        initCmd = initialCmdRef.current;
        initialFiredRef.current = true;
        s.lastCommand = initCmd;
        if (s.key === activeKeyRef.current) setActiveCommand(initCmd);
      }
      const sid = await invoke<string>("term_open", {
        cols: s.term.cols || 80,
        rows: s.term.rows || 24,
        onData,
        initialCmd: initCmd,
        cwd: cwdRef.current ?? null,
        tool: toolRef.current ?? null,
      });
      s.sessionId = sid;
      return sid;
    } catch (e) {
      s.term.writeln(`\x1b[31mFailed to open terminal: ${String(e)}\x1b[0m`);
      return null;
    }
  }, []);

  // 新建一个终端标签
  const newTerm = useCallback((): TermSession | undefined => {
    const host = hostRef.current;
    if (!host) return;
    const key = ++seqRef.current;
    const el = document.createElement("div");
    // 底部多留 6px：WebGL 画布按像素取整时，最后一行在某些 DPI/窗口高度下会贴边被裁。
    // FitAddon 会把 padding 从可用高度扣掉，不是用遮罩盖住 TUI。
    el.style.cssText = "position:absolute;inset:0;padding:6px 8px 12px;";
    host.appendChild(el);

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: fontSizeRef.current,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // WebGL 渲染器（VS Code / Wave 同款）—— claude code 这类高频全屏 TUI 刷新时，
    // 比默认渲染顺滑很多，明显减少闪烁/撕裂/输入行错位。上下文丢失时自动 dispose 回退默认。
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose()); // GPU 上下文丢了就卸载，xterm 自动回退 DOM 渲染
      term.loadAddon(webgl);
    } catch {
      /* 不支持 WebGL（极少数环境）→ 用默认渲染，不影响功能 */
    }

    const s: TermSession = {
      key, title: `Terminal ${key}`, term, fit, sessionId: null, el,
      disposed: false, lastCols: 0, lastRows: 0, lastCommand: null, pendingInput: "",
    };
    term.onData((d) => {
      // —— 焦点上报泄漏防护（DECSET 1004）——
      // claude/codex 等 TUI 启用「焦点上报」(\e[?1004h) 后若崩溃/被杀，没机会发关闭序列
      // (\e[?1004l)，xterm 内部这个模式就卡在开着。之后终端每次失/获焦点（点别处、切窗口、
      // alt-tab、点标签…）xterm 都会朝 PTY 发一个裸 \e[O / \e[I，落到已回到 shell 的命令行里
      // → `[Occd`、`> I` 这类「突然吐乱码 / 命令被污染」。这俩裸序列键盘敲不出来、对本工作台
      // 任何工具也无实际功能，就在 xterm→PTY 这唯一出口处吞掉，根治所有焦点来源
      // （比逐个按钮 preventDefault 彻底）。
      if (d === "\x1b[I" || d === "\x1b[O") return;
      // 捕获用户在 shell 里手动输入的简单启动命令，让「Codex 历史 Ctrl+T」提示
      // 不只依赖顶部快捷按钮。复杂行编辑不猜测，只处理可打印字符、退格和回车。
      if (d === "\r") {
        const command = s.pendingInput.trim();
        if (/^codex(?:\.exe)?(?:\s|$)/i.test(command)) {
          s.lastCommand = command;
          if (s.key === activeKeyRef.current) setActiveCommand(command);
        } else if (/^(?:claude|hermes|opencode)(?:\.exe)?(?:\s|$)/i.test(command)) {
          s.lastCommand = command;
          if (s.key === activeKeyRef.current) setActiveCommand(command);
        }
        s.pendingInput = "";
      } else if (d === "\x7f" || d === "\b") {
        s.pendingInput = s.pendingInput.slice(0, -1);
      } else if (/^[\x20-\x7e]+$/.test(d) && s.pendingInput.length < 512) {
        s.pendingInput += d;
      }
      if (s.sessionId) invoke("term_write", { sessionId: s.sessionId, data: d }).catch(() => {});
    });

    // —— 复制/粘贴 ——
    // xterm 默认不接管剪贴板，导致 /login 这类长 code 粘不进去。这里补齐：
    //  · Ctrl/Cmd+V：把剪贴板文本原样写进 PTY（长 OAuth code 一次性贴入）
    //  · Ctrl/Cmd+C：有选区→复制选区；无选区→放行给程序当中断信号（^C）
    //  · 右键 / Shift+Insert：直接粘贴（终端惯例）
    const writeToPty = (text: string) => {
      if (!text || !s.sessionId) return;
      // CRLF/LF 统一成 CR（PTY 行尾用 \r），避免多敲回车
      const data = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
      invoke("term_write", { sessionId: s.sessionId, data }).catch(() => {});
    };
    // 粘贴：优先走 Rust 后端读系统剪贴板（WebView2 焦点在 xterm 时 navigator.clipboard
    // 常被拒），失败再退回浏览器 API 兜底。
    const pasteFromClipboard = () => {
      invoke<string>("clipboard_read")
        .then(writeToPty)
        .catch(() => {
          navigator.clipboard.readText().then(writeToPty).catch(() => {});
        });
    };
    // 复制：选区文本写系统剪贴板（同样优先后端）。
    const copySelection = (sel: string) => {
      invoke("clipboard_write", { text: sel }).catch(() => {
        navigator.clipboard.writeText(sel).catch(() => {});
      });
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "v" || e.key === "V")) {
        pasteFromClipboard();
        return false; // 别让 xterm 再处理
      }
      if (mod && (e.key === "c" || e.key === "C")) {
        const sel = term.getSelection();
        if (sel) {
          copySelection(sel);
          return false; // 有选区→复制，吞掉
        }
        return true; // 无选区→放行（^C 中断）
      }
      if (e.shiftKey && e.key === "Insert") {
        pasteFromClipboard();
        return false;
      }
      // 字号：Ctrl/Cmd + 加号 放大、减号 缩小、0 复位 14（VS Code 同款）
      if (mod && (e.key === "=" || e.key === "+")) {
        bumpFontSize(1);
        return false;
      }
      if (mod && (e.key === "-" || e.key === "_")) {
        bumpFontSize(-1);
        return false;
      }
      if (mod && e.key === "0") {
        bumpFontSize(14 - fontSizeRef.current);
        return false;
      }
      // 软重置（Ctrl/Cmd+Shift+R）：一键清掉 TUI 崩溃残留的卡死模式（鼠标乱码/花屏/光标消失…）。
      // preventDefault 挡掉 WebView「刷新页面」默认；写 xterm 不发 PTY，shell 命令行不受影响。
      if (mod && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        s.term.write(SOFT_RESET_SEQ);
        return false;
      }
      return true;
    });
    // 选中即复制（终端惯例）：鼠标选完自动进剪贴板，方便复制 token
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) copySelection(sel);
    });
    // 右键直接粘贴（不弹原生菜单）
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      pasteFromClipboard();
    });
    // 浏览器原生 paste 事件兜底（中键粘贴等）
    el.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text");
      if (text) {
        e.preventDefault();
        writeToPty(text);
      }
    });

    sessionsRef.current.push(s);
    setTabs((t) => [...t, { key, title: s.title }]);
    setActiveKey(key);
    setTimeout(() => {
      if (s.disposed) return; // 50ms 内已被关掉：别 fit/focus 已 dispose 的 xterm
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      ensurePty(s).then((sid) => {
        // ensurePty 期间被关：后端可能已起 PTY，补一刀关掉，别留孤儿
        if (s.disposed) {
          if (sid) invoke("term_close", { sessionId: sid }).catch(() => {});
          return;
        }
        if (s.sessionId) {
          s.lastCols = term.cols;
          s.lastRows = term.rows;
          invoke("term_resize", { sessionId: s.sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
        }
      });
      term.focus();
    }, 50);
    return s;
  }, [ensurePty]);

  // 关闭一个终端标签
  const closeTerm = useCallback((key: number) => {
    const arr = sessionsRef.current;
    const idx = arr.findIndex((x) => x.key === key);
    if (idx < 0) return;
    const s = arr[idx];
    s.disposed = true; // 标记已关：拦截尚未返回的 setTimeout/ensurePty 回调
    if (s.sessionId) invoke("term_close", { sessionId: s.sessionId }).catch(() => {});
    s.term.dispose();
    s.el.remove();
    arr.splice(idx, 1);
    setTabs((t) => t.filter((x) => x.key !== key));
    // 关的是当前激活格 → 切到邻格并给焦点；关的是后台格 → activeKey 不变
    setActiveKeyState((cur) => {
      if (cur !== key) return cur;
      const next = arr[idx] ?? arr[idx - 1] ?? null;
      const nk = next ? next.key : null;
      setActiveCommand(next?.lastCommand ?? null);
      if (nk != null) requestAnimationFrame(() => next?.term.focus());
      return nk;
    });
  }, []);

  // 切换显示哪个终端（display 切换，不动 PTY）→ 只 fit，不抢焦点。
  // 不在这里 focus()：否则任何让 open/activeKey effect 重跑的外部重渲染（如对话面板
  // 动态刷新）都会把焦点从你正在打字的输入框强行抢到终端 → 输入框"失焦消失"。
  // 焦点只在用户主动操作终端时给（newTerm / 点标签 / 点快捷词），见下方各处显式 focus。
  useEffect(() => {
    for (const s of sessionsRef.current) {
      s.el.style.display = s.key === activeKey ? "block" : "none";
    }
    if (open) fitActive();
  }, [activeKey, open, fitActive]);

  // 可见时：没有任何终端就新建一个；有就 fit 当前（统一防抖）。同样不抢焦点。
  useEffect(() => {
    if (!open) return;
    if (sessionsRef.current.length === 0) {
      newTerm();
    } else {
      fitActive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 待运行命令：在当前（或新建）终端里跑
  useEffect(() => {
    if (!open || !pendingCmd) return;
    let cancelled = false;
    (async () => {
      let s = sessionsRef.current.find((x) => x.key === activeKey);
      if (!s) s = newTerm();
      if (!s) return;
      const sid = await ensurePty(s);
      if (cancelled || !sid) return;
      await invoke("term_write", { sessionId: sid, data: pendingCmd + "\r" }).catch(() => {});
      onConsumedCmd?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingCmd]);

  // 在当前激活终端（没有则新建）跑一条命令 —— 终端顶部快捷按钮用
  const runInActive = useCallback(
    (cmd: string) => {
      void (async () => {
        let s = sessionsRef.current.find((x) => x.key === activeKeyRef.current);
        if (!s) s = newTerm();
        if (!s) return;
        const sid = await ensurePty(s);
        if (!sid) return;
        s.lastCommand = cmd;
        setActiveCommand(cmd);
        await invoke("term_write", { sessionId: sid, data: cmd + "\r" }).catch(() => {});
        s.term.focus();
      })();
    },
    [newTerm, ensurePty],
  );

  // 往当前激活终端写原始文本（不回车）—— 拖放文件/图片/文件夹落路径用
  const pasteToActive = useCallback(
    (text: string) => {
      if (!text) return;
      void (async () => {
        let s = sessionsRef.current.find((x) => x.key === activeKeyRef.current);
        if (!s) s = newTerm();
        if (!s) return;
        const sid = await ensurePty(s);
        if (!sid) return;
        await invoke("term_write", { sessionId: sid, data: text }).catch(() => {});
        s.term.focus();
      })();
    },
    [newTerm, ensurePty],
  );

  // 软重置当前激活终端的模拟器状态 —— 详见 SOFT_RESET_SEQ 注释。只写 xterm，不碰 PTY/shell。
  const resetActive = useCallback(() => {
    const s = sessionsRef.current.find((x) => x.key === activeKeyRef.current);
    if (!s) return;
    s.term.write(SOFT_RESET_SEQ);
    s.term.focus();
  }, []);

  // 容器尺寸变化 → 统一防抖 fit（rAF 合并；拖拽时 ResizeObserver 会高频触发，
  // 合并后每帧最多 fit 一次，不再抖）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => fitActive());
    ro.observe(host);
    return () => ro.disconnect();
  }, [fitActive]);

  // 卸载：关掉本 group 所有 PTY（仅在调用组件真正卸载时触发——
  // 工作台靠常驻 + display 切换保活，只有「关闭任务」才卸载 TermPanel）
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      for (const s of sessionsRef.current) {
        s.disposed = true; // 拦截 in-flight 异步回调
        if (s.sessionId) invoke("term_close", { sessionId: s.sessionId }).catch(() => {});
        s.term.dispose();
      }
      sessionsRef.current = [];
    };
  }, []);

  return {
    hostRef, tabs, activeKey, setActiveKey, newTerm, closeTerm, runInActive, pasteToActive,
    fontSize, bumpFontSize, resetActive, activeCommand,
  };
}
