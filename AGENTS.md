# AGENTS.md

给 Codex 的项目说明。本目录是 **OpenCodex** —— 开源、绿色的本地编程工作台。

## 这是什么

以**文件夹**为基础的多终端 AI 编程与管理工作台（Codex 同款体验）。选一个项目文件夹 →
和用户**自带的模型**对话 → 需要时从对话顶栏滑出应用内真终端、文件树、浏览器。常驻保活。

**完全本地、开源、无服务器、无内置 Key**。派生自 U-King 的 OpenCodex 工作台模块，已剥离全部
商业/分发逻辑（虾盘云 Key、设备指纹、余额、充值、bug 上报、自升级、装机向导、托盘、右键菜单等）。

用户沟通用中文。

## 架构

两层，没有 sidecar：React（WebView）⟷ Tauri 2（Rust）。

后端 command（`lib.rs::invoke_handler`）：

| command | 作用 | 实现 |
|---|---|---|
| `get_env` | 平台 / 主目录 / `--open-dir` 透传 | lib.rs |
| `get_config` / `set_config` | 自带模型配置（只读/写 ~/.opencodex/config.json） | config.rs |
| `term_open` / `term_write` / `term_resize` / `term_close` / `list_running` | 应用内 PTY 终端 | term.rs |
| `list_tasks` / `upsert_task` / `remove_task` | 会话/任务持久化 | tasks.rs |
| `claude_send` / `claude_interrupt` / `claude_reset` | 结构化 Codex 对话流 | agent/Codex.rs |
| `list_dir` / `read_text_file` | 文件面板 | fs.rs |
| `open_browser` | 浏览器面板（独立 webview 子窗口） | lib.rs |
| `hide_window` | 隐藏窗口 | lib.rs |

## 关键设计

- **`paths.rs` 是 PATH 注入的唯一真相源**：`search_paths()` 前置便携 Node/Python + npm 全局目录，
  让双击启动（Explorer/Finder 给的瘦 PATH）也能找到 `Codex`/`codex`。term.rs、agent、config 都复用它。
  可选便携运行时放 `~/.opencodex/runtime/{node,python}`，解压即被发现。
- **自带模型（config.rs）**：只读写 `~/.opencodex/config.json`。OpenCodex 启动的终端和 AI 子进程会临时注入
  ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL。
  不写 `~/.claude/settings.json`，不改登录态，不改系统环境变量，不静默覆盖用户在 Claude Code 里的模型、代理、Key。
  **不连任何服务器，无内置 Key**。
- **PTY 保活**：一个会话 = 一个长驻 shell。收起面板只 hide UI 不杀进程。reader/writer 热路径
  零 unwrap（release 是 `panic=abort`）。`term_open` 的初始命令过 `validate_cmd` 白名单（挡 shell 注入）。
- **结构化对话**：`Codex --output-format stream-json` 逐行解析成统一事件
  （session/text/tool_start/tool_input/tool_end/usage/done），React 渲染成卡片 + 内联 diff。
  多轮靠 `--resume <session_id>` 续接。
- **UI 保活**：OpenCodex 整组常驻渲染，靠 `display` 切换（切会话不卸载 → PTY/历史续存）。

## 常用命令

```bash
pnpm install                 # 装前端依赖（如遇代理缓存问题见下）
pnpm tauri dev               # 开发模式（弹窗 + HMR）
cd src-tauri && cargo check  # Rust 快速类型检查
pnpm build                   # 前端 tsc + vite build
pnpm tauri build             # 出 exe + NSIS 安装包
```

构建产物：`src-tauri/target/release/opencodex.exe`。

## 验证方式（无头自检）

没有测试框架。验证 = `cargo check` + `pnpm build` + 一个无头 PTY 模式：

```bash
cargo run -- --term-test "node --version"   # 验证 PTY + PATH 注入，不依赖 GUI
```

实测基线（2026-06-16）：`--term-test "node --version"` 经 PowerShell PTY 正确回 `v22.14.0`。

## 数据位置

- `~/.opencodex/tasks.json` —— 会话列表
- `~/.opencodex/config.json` —— 模型配置记录
- `~/.opencodex/runtime/{node,python}` —— 可选便携运行时

## 注意事项（Windows / 本机环境）

- 用 Git Bash，Unix 路径语法；目录名含中文，路径要加引号。
- 代理在 `127.0.0.1:7897`。`pnpm install` 偶尔取到陈旧 registry 元数据时，加 `HTTPS_PROXY` 环境变量重试。
- `tsconfig.json` 开了 `noUnusedLocals`/`noUnusedParameters` —— 改前端时别留未用变量，否则 `tsc` 报错。
- Rust release profile 是 `panic=abort` + `opt-level=z`，PTY reader/writer 热路径勿引入 unwrap。

## 跟其他模块的关系

- 上游来源：`../u-king简化版-u盘版本/`（OpenCodex 工作台 + term.rs + agent 都源自此，已去商业化）。
