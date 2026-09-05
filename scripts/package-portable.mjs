#!/usr/bin/env node
/**
 * 从刚构建的 exe 制作可发布的绿色 ZIP。
 *
 * 永远新建 staging，绝不复用曾经启动过的 portable-data；那里可能含任务、路径和用户 Key。
 * `portable-data/README.txt` 既让 ZIP 保住这个目录，也向用户说明哪些文件应留在本机。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const exe = join(root, "src-tauri", "target", "release", "opencodex.exe");
const release = join(root, "release");
const stage = join(release, `OpenCodex-v${version}-portable`);
const zip = join(release, `OpenCodex-v${version}-portable.zip`);

if (!existsSync(exe)) throw new Error(`找不到发布 exe：${exe}\n请先运行 pnpm tauri build`);
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(join(stage, "portable-data"), { recursive: true });
cpSync(exe, join(stage, "OpenCodex.exe"));
writeFileSync(join(stage, "portable-data", "README.txt"), "OpenCodex 的便携数据目录。\r\n\r\n首次启动后，任务、快捷项和可选的临时 Claude Code 对话路由会保存在这里。请勿把包含个人数据的此目录再次打包或分享。\r\n", "utf8");

const ps = (s) => `'${s.replaceAll("'", "''")}'`;
execFileSync("powershell.exe", [
  "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
  `$ErrorActionPreference='Stop'; Compress-Archive -Path ${ps(join(stage, "*"))} -DestinationPath ${ps(zip)} -Force`,
], { stdio: "inherit" });

const sha256 = createHash("sha256").update(readFileSync(join(stage, "OpenCodex.exe"))).digest("hex");
console.log(`已创建干净绿色包：${zip}`);
console.log(`OpenCodex.exe SHA256: ${sha256}`);
