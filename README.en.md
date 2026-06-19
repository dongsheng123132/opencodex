# OpenCodex

[简体中文](./README.md) · **English**

> An open-source, portable (no-install) local coding workbench — **folder-based** multi-terminal AI coding & management.

OpenCodex is a Codex-style desktop workbench: pick a project folder → the main area **is a real in-app terminal**, where you run Claude Code / Codex and other CLIs → split it left/right or top/bottom to run several at once → slide out a file tree or browser from the top bar when needed. Everything stays alive: switching sessions never kills your terminal processes.

Fully local, open-source, **bring-your-own-model**: ships no API keys, points at no relay/server. You fill in your own Base URL + API Key (DeepSeek / Zhipu / Kimi / Anthropic official / local ollama / any OpenAI- or Anthropic-compatible endpoint).

![OpenCodex main UI — a 2×2 terminal split inside one folder](docs/screenshot-main.png)

## Why this exists

Codex-class tools are arguably the **first "automatic-transmission car" in AI history** — an all-round hexagonal powerhouse. Less a single soldier, more a **one-person legion**:

- **Folder-based multi-process management**: a modern "file-processing factory." The most basic — yet most underrated — capability. Plenty of big-company PMs still haven't managed to copy this homework right.
- **Manus-style office integration**: pull email, write Notion, wire your workflow together.
- **Computer Use**: the real killer feature — the first automatic-transmission car in AI history, unlocking a staggering range of uses.
- **Coding**: capable, but slow and fiddly — like embroidery. Far less brute-force than Claude Code's "Katyusha rocket barrage" (neither is nuclear-grade yet).
- **Image generation**: nuclear-grade. Designers and front-end folks, take cover.
- Combine these elite units and you get an unbeatable **Roman legion**. Codex even lets you bring in "mercenaries" now — third-party models plug right in.

But Codex itself has two hard limits: **it's not open-source, and it's heavy.**

### The gap we saw

1. Existing competitors are mostly **too heavy**.
2. Earlier multi-task / multi-terminal managers exist, but most are built around **human-facing** workflows.
3. There's still **no lightweight, Codex-style tool built for AI-driven multi-terminal coding collaboration**.

### So: OpenCodex

- **Core**: folder-based, high-completion multi-task / multi-terminal management.
- **Collaboration**: open many terminals under one folder and run multiple Claude Code instances for **multi-process coding** — smooth.
- **Lightweight**: against Codex's closed-source, heavyweight footprint, this is a **~4.7 MB portable build** (Tauri, reuses the system WebView — no bundled browser engine), better suited to real dev work.

In one line: take Codex's most core, most underrated ability — the AI-facing multi-terminal factory — and make it open-source, portable, and bring-your-own-model.

### Roadmap

- First, make the current **Demo** solid.
- Then keep stacking features (local-LLM manager, office integration, …).
- Ship a **multi-language build for a global release** and open-source it on GitHub to gauge interest.

## Features

- **Folder-based multi-terminal factory**: one folder per project; sessions grouped by project on the left; the main area is the terminal.
- **Split & run many**: split left/right or top/bottom inside one folder, running several Claude Code-style CLIs for multi-process coding. Splitting only **repositions** panes — running terminals are never destroyed.
- **Real in-app terminal (PTY)**: Rust-owned PTY (`portable_pty`), rendered by xterm.js with **WebGL** (smooth under high-frequency TUI repaints). PATH auto-injects portable Node/Python and the global `npm` dir, so `claude`/`codex` just work. Closing a terminal **kills the whole child process tree** — no orphans.
- **Drag to drop paths**: drag a file / image / folder into the terminal → its real path is typed into the command line (handy for showing images to Claude Code, or feeding file paths).
- **Layout memory + adjustable font**: split layout restores on relaunch; font size via `Ctrl ±` or toolbar buttons, persisted.
- **Slide-out panels**: from the top bar, slide out a file tree / browser; resizable, dismissable.
- **Bring-your-own-model**: enter Base URL / API Key / model in Model Settings; written to the `env` block of `~/.claude/settings.json`, applied hot.
- **Portable exe**: ~4.7 MB, size-first release profile (`opt-level=z` + LTO + strip), single executable, reuses the system WebView.

## Stack

Two layers, no sidecar: **React (WebView) ⟷ Tauri 2 (Rust)**.

## Development

```bash
pnpm install            # install frontend deps
pnpm tauri dev          # dev mode (window + HMR)
cd src-tauri && cargo check   # quick Rust type-check
pnpm tauri build        # produce exe + installer
```

Headless self-test (no GUI; verifies PTY + PATH injection):

```bash
cargo run -- --term-test "node --version"
```

## Usage

1. Launch OpenCodex.
2. Top-right "Model Settings" → fill your Base URL / API Key / model (presets available).
3. The terminal needs the `claude` CLI — if missing, run `npm i -g @anthropic-ai/claude-code` in a terminal pane.
4. "New project" → pick a folder → start working. Split for more terminals; slide out files / browser when needed.

## Data locations

- Session list: `~/.opencodex/tasks.json`
- Model config: `~/.opencodex/config.json` + the `env` block of `~/.claude/settings.json`
- Terminal layout & font / misc state: `~/.opencodex/kv.json`
- Optional portable runtime: `~/.opencodex/runtime/{node,python}` (unzip here to be auto-discovered and added to PATH)

## License

[MIT](./LICENSE). No bundled keys, billing, activation, or telemetry — a pure local tool.

> "Claude"/"Claude Code" are trademarks of Anthropic; "Codex" is a trademark of OpenAI. OpenCodex is an independent open-source project, not affiliated with or endorsed by either, and only runs the AI CLI / model endpoints you configure.

---

Open-sourced from an internal workbench module, with all commercial/distribution logic stripped out.
