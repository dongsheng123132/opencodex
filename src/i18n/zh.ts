/**
 * 中文字典 —— `{英文原文: 中文译文}`。
 * 键是组件里 `t("...")` 的英文原文（英文即 key）；未收录的串回退英文，可增量补。
 */

export const ZH: Record<string, string> = {
  // —— 顶栏 / App ——
  "Model Settings": "模型设置",
  "Settings": "设置",
  "AI model": "AI 模型",
  "Data & migration": "数据与迁移",
  "About": "关于",
  "{n} terminal(s) running": "{n} 个终端正在运行",
  "OpenCodex": "OpenCodex",
  "Run in terminal: {cmd}": "在终端中运行: {cmd}",

  // —— 会话栏（SessionList）——
  "Sessions": "会话",
  "Collapse session bar (give the space to the terminal)": "收起会话栏（把空间让给终端）",
  "Expand session bar": "展开会话栏",
  "New chat": "新对话",
  "Import projects & sessions from U-King workspace (~/.uking/tasks.json)": "从 U-King 工作台导入项目与会话（~/.uking/tasks.json）",
  "New project (pick a folder)": "新建项目（选择文件夹）",
  "Select a project folder": "选择项目文件夹",
  "Open projects": "打开的项目",
  "No projects yet.": "还没有项目。",
  'Click "New" to pick a folder': '点「新建」选择文件夹',
  "and put several AIs to work in it.": "然后把多个 AI 放进同一个项目里干活。",
  "Running": "运行中",
  "Last run failed": "上一轮出错",
  "Standby — has history, click to resume": "待命 —— 有对话历史，点进去接着聊",
  "Idle — no messages yet": "空闲 —— 还没聊过",
  "Collapse this project": "收起该项目",
  "Expand this project": "展开该项目",
  "{n} session(s) hidden": "隐藏 {n} 个会话",
  "Delete the whole project (removes all its sessions; the folder on disk is untouched)":
    "删除整个项目（移除其下所有会话；磁盘上的文件夹不动）",
  "New worktree (work on another branch in parallel)": "新建 worktree（并行在另一个分支上工作）",
  "Open a new AI session in this project": "在此项目新开一个 AI 会话",
  "Branch name (Enter to confirm)": "分支名（回车确认）",
  "New": "新建",
  "Failed to create worktree: {e}": "创建 worktree 失败: {e}",
  "Close session (asks first if it has history; the folder on disk is untouched)":
    "关闭会话（有历史会先询问；磁盘上的文件夹不动）",
  "Double-click to rename": "双击可重命名",
  "Plugins (coming soon)": "插件（即将推出）",
  "Import U-King": "导入 U-King",
  "Importing…": "导入中…",
  "Drag to resize the session bar · double-click to collapse": "拖动调整会话栏宽度 · 双击收起",
  "Close this session? It has a conversation history, which can't be recovered.\n(The folder on disk is untouched — only this session and its chat record go away.)":
    "关闭这个会话？它有对话历史，关掉就找不回来了。\n（磁盘上的文件夹不动，只是这个会话和它的聊天记录没了）",
  "Close all {n} session(s) in this project? {c} of them have conversation history that can't be recovered.\n(The folder on disk is untouched.)":
    "关闭这个项目下的 {n} 个会话？其中 {c} 个有对话历史，关掉就找不回来了。\n（磁盘上的文件夹不动）",
  "Close all {n} session(s) in this project? (None have chat history yet; the folder on disk is untouched.)":
    "关闭这个项目下的 {n} 个会话？（都还没聊过；磁盘上的文件夹不动）",
  "No U-King workspace data found (~/.uking/tasks.json)": "没有找到 U-King 工作台数据（~/.uking/tasks.json）",
  "Imported {n} project session(s) from U-King ({s} already present)":
    "已从 U-King 导入 {n} 个项目会话（{s} 个已存在）",
  "Nothing to import — all {n} U-King project(s) already here": "没有可导入的 —— {n} 个 U-King 项目已全部存在",
  "Import failed: {e}": "导入失败: {e}",
  "OpenCodex version": "OpenCodex 版本",

  // —— 主区 / 布局（OpenCodex / SplitArea）——
  "Open a folder and get to work": "打开一个文件夹，开始干活",
  "Pick a folder — the main area is a real terminal running claude / codex.\nSplit left/right or top/bottom to run several at once, and slide out a file tree\nor browser from the top bar when you need it.":
    "选一个文件夹作为项目 —— 主区是真实终端，直接跑 claude / codex。\n左右/上下分屏可以同时跑多个，需要时从顶栏滑出文件树或浏览器。",
  "Files": "文件",
  "Browser": "浏览器",
  "Split horizontally (open another terminal)": "水平分屏（再开一个终端）",
  "Split vertically (open another terminal)": "垂直分屏（再开一个终端）",
  "Model settings (bring your own model)": "模型设置（自带模型）",
  "Model": "模型",
  "Collapse": "收起",

  // —— 模型设置（SettingsDialog）——
  "Model Settings · Bring Your Own Model": "模型设置 · 自带模型",
  "Please enter a Base URL": "请输入 Base URL",
  "Saved — sessions will use your model": "已保存 —— 会话将使用你的模型",
  "Save failed: {e}": "保存失败: {e}",
  "Quick fill (fills the form only, sends no request)": "快速填充（只填表单，不发送请求）",
  "Get a key at platform.deepseek.com": "在 platform.deepseek.com 获取 Key",
  "Get a key at bigmodel.cn": "在 bigmodel.cn 获取 Key",
  "Get a key at platform.moonshot.cn": "在 platform.moonshot.cn 获取 Key",
  "Get a key at console.anthropic.com": "在 console.anthropic.com 获取 Key",
  "Base URL": "Base URL",
  "Any Anthropic-compatible endpoint": "任意 Anthropic 兼容端点",
  "API Key": "API Key",
  "Stored locally in ~/.opencodex/config.json, never uploaded": "只保存在本地 ~/.opencodex/config.json，绝不上传",
  "Main model": "主模型",
  "Small / fast model": "小 / 快模型",
  "Optional": "可选",
  "Cancel": "取消",
  "Saving…": "保存中…",
  "Save": "保存",

  // —— 文件面板（FilesPanel）——
  "New file": "新建文件",
  "New folder": "新建文件夹",
  "Refresh": "刷新",
  "Open": "打开",
  "Open with default app": "用默认程序打开",
  "Preview": "预览",
  "Rename": "重命名",
  "Delete (to Recycle Bin)": "删除（到回收站）",
  "Copy": "复制",
  "Cut": "剪切",
  "Copy path": "复制路径",
  "Show in File Explorer": "在文件资源管理器中显示",
  'Paste "{name}"': '粘贴 "{name}"',

  // —— 终端面板（TermPanel）——
  "Click again to confirm close": "再点一次确认关闭",
  "Close this terminal": "关闭此终端",
  "New terminal tab": "新建终端标签",
  "Decrease font size (Ctrl -)": "减小字体（Ctrl -）",
  "Increase font size (Ctrl +)": "增大字体（Ctrl +）",
  "Current font size": "当前字号",
  "Reset terminal (Ctrl+Shift+R): clears mouse garbage, screen artifacts, and lost-cursor states left behind when claude/codex-style TUIs crash":
    "重置终端（Ctrl+Shift+R）：清掉 claude/codex 这类 TUI 崩溃后残留的鼠标垃圾、屏幕残影和光标丢失",
  "Delete this shortcut": "删除此快捷按钮",
  "Edit this shortcut": "编辑此快捷按钮",
  "Add a custom shortcut": "添加自定义快捷按钮",
  "Shortcut": "快捷项",
  "Edit shortcut": "编辑快捷按钮",
  "Restore default shortcuts": "恢复默认快捷按钮",
  "Add a shortcut (clicking it sends the command to the terminal)": "添加快捷按钮（点击后把命令发给终端）",
  "Button label (e.g. /model)": "按钮名（如 /model）",
  "Command to send (blank = same as label)": "要发送的命令（留空 = 同按钮名）",
  "Drop to insert the path into the command line": "拖放到此处，把路径插入命令行",

  // —— 浏览器面板（BrowserPanel）——
  "Open in a separate window (for pages that block embedding)": "在新窗口打开（用于禁止内嵌的页面）",
  "Open a preview page embedded on the right (localhost works too)": "在右侧打开内嵌预览页（localhost 也可以）",
  "If the page is blank (embedding blocked), click ⬈ on the right of the address bar to open it in a separate window":
    "如果页面空白（禁止内嵌），点地址栏右侧的 ⬈ 在新窗口打开",
};
