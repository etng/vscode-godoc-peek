import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { GoSymbolRef } from "./symbolLocator";
import { log } from "./outputChannel";

export interface GoDocResult {
  readonly text: string;
  /** Where the documentation came from, shown in the hover footer. */
  readonly source: string;
  /** The command that produced it, shown in the hover footer. */
  readonly command: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MISS_CACHE_TTL_MS = 2 * 60 * 1000;
const LOCAL_TIMEOUT_MS = 10_000;
const GO_GET_TIMEOUT_MS = 120_000;
const MOD_INIT_TIMEOUT_MS = 30_000;
const MAX_CACHE_ENTRIES = 200;
const MAX_OUTPUT_BYTES = 256 * 1024;

/** Errors from `go doc` that mean "not resolvable locally, try the network". */
const NEEDS_DOWNLOAD =
  /no required module provides package|go\.mod file not found|cannot find package|no packages? (?:found|matched)/i;

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: GoDocResult | undefined;
}

interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type GoDocAttempt =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly error: string };

const cache = new Map<string, CacheEntry>();
const pendingDownloads = new Map<string, Promise<boolean>>();

let scratchModuleDir: string | undefined;
let goBinary = "go";

export function configureGoDoc(context: vscode.ExtensionContext): void {
  scratchModuleDir = path.join(context.globalStorageUri.fsPath, "scratch-module");
  const alternateTools = vscode.workspace
    .getConfiguration("go")
    .get<Record<string, string>>("alternateTools");
  goBinary = alternateTools?.go || "go";
}

export function clearGoDocCache(): void {
  cache.clear();
}

/** Directory `go doc` should run in: nearest go.mod, else the workspace folder. */
export function resolveGoWorkingDirectory(
  document: vscode.TextDocument,
): string | undefined {
  const configured = vscode.workspace
    .getConfiguration("godocPeek")
    .get<string>("goDoc.workingDirectory")
    ?.trim();
  if (configured) {
    return configured;
  }

  if (document.uri.scheme === "file") {
    let dir = path.dirname(document.uri.fsPath);
    const { root } = path.parse(dir);
    while (true) {
      if (fs.existsSync(path.join(dir, "go.mod"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (dir === root || parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  return folder?.uri.scheme === "file" ? folder.uri.fsPath : undefined;
}

export async function resolveGoDoc(
  ref: GoSymbolRef,
  cwd: string | undefined,
  token: vscode.CancellationToken,
): Promise<GoDocResult | undefined> {
  const key = `${cwd ?? "<none>"}|${ref.importPath}|${ref.symbol}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await lookup(ref, cwd, token);
  cache.set(key, {
    expiresAt: Date.now() + (value ? CACHE_TTL_MS : MISS_CACHE_TTL_MS),
    value,
  });
  trimCache();
  return value;
}

async function lookup(
  ref: GoSymbolRef,
  cwd: string | undefined,
  token: vscode.CancellationToken,
): Promise<GoDocResult | undefined> {
  let lastError: string | undefined;

  for (const query of ref.queries) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const result = await runGoDoc(query, cwd, token, LOCAL_TIMEOUT_MS);
    if (result.ok) {
      return {
        text: result.stdout,
        source: cwd ? "go doc（工作区模块）" : "go doc",
        command: `go doc ${query}`,
      };
    }
    lastError = result.error ?? lastError;
  }

  const config = vscode.workspace.getConfiguration("godocPeek");
  if (!config.get<boolean>("networkFallback", true)) {
    logMiss(ref, "networkFallback 已关闭", lastError);
    return undefined;
  }
  if (!lastError || !NEEDS_DOWNLOAD.test(lastError)) {
    logMiss(ref, "本地模块里查不到该符号", lastError);
    return undefined;
  }

  const remote = await lookupRemotely(ref, token, lastError);
  if (!remote) {
    logMiss(ref, `已尝试联网获取 ${ref.importPath}`, undefined);
  }
  return remote;
}

function logMiss(
  ref: GoSymbolRef,
  reason: string,
  detail: string | undefined,
): void {
  const firstLine = detail?.split("\n")[0];
  log(`未找到 ${ref.raw} 的文档：${reason}${firstLine ? ` — ${firstLine}` : ""}`);
}

async function lookupRemotely(
  ref: GoSymbolRef,
  token: vscode.CancellationToken,
  reason: string,
): Promise<GoDocResult | undefined> {
  const dir = await ensureScratchModule(token);
  if (!dir) {
    return undefined;
  }

  log(`本地查不到 ${ref.importPath}（${reason}），在临时模块中获取…`);
  if (!(await ensurePackage(ref.importPath, dir, token))) {
    return undefined;
  }

  for (const query of ref.queries) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const result = await runGoDoc(query, dir, token, LOCAL_TIMEOUT_MS);
    if (result.ok) {
      return {
        text: result.stdout,
        source: "go doc（临时模块，已联网下载）",
        command: `go doc ${query}`,
      };
    }
  }

  return undefined;
}

async function ensureScratchModule(
  token: vscode.CancellationToken,
): Promise<string | undefined> {
  const dir = scratchModuleDir;
  if (!dir) {
    return undefined;
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, "go.mod"))) {
      const init = await run(
        goBinary,
        ["mod", "init", "godoc-peek-scratch"],
        dir,
        MOD_INIT_TIMEOUT_MS,
        token,
      );
      if (init.code !== 0) {
        log(`创建临时模块失败：${(init.stderr || init.stdout).trim()}`);
        return undefined;
      }
    }
    return dir;
  } catch (error) {
    log(`创建临时模块失败：${String(error)}`);
    return undefined;
  }
}

function ensurePackage(
  importPath: string,
  dir: string,
  token: vscode.CancellationToken,
): Promise<boolean> {
  const existing = pendingDownloads.get(importPath);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const result = await run(
      goBinary,
      ["get", `${importPath}@latest`],
      dir,
      GO_GET_TIMEOUT_MS,
      token,
    );
    if (result.code !== 0) {
      log(`go get ${importPath} 失败：${(result.stderr || result.stdout).trim()}`);
      return false;
    }
    return true;
  })().finally(() => pendingDownloads.delete(importPath));

  pendingDownloads.set(importPath, task);
  return task;
}

async function runGoDoc(
  query: string,
  cwd: string | undefined,
  token: vscode.CancellationToken,
  timeoutMs: number,
): Promise<GoDocAttempt> {
  const args = query.includes(" ") ? query.split(" ") : [query];
  const result = await run(goBinary, ["doc", ...args], cwd, timeoutMs, token);

  if (result.code === 0 && result.stdout.trim()) {
    return { ok: true, stdout: result.stdout.trimEnd() };
  }

  return {
    ok: false,
    error: (result.stderr || result.stdout || `go doc ${query} 无输出`).trim(),
  };
}

function run(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
  timeoutMs: number,
  token: vscode.CancellationToken,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    /** Holds the cleanup handles so `finish` can drop them. */
    const handles: { timer?: NodeJS.Timeout; subscription?: vscode.Disposable } = {};

    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (handles.timer) {
        clearTimeout(handles.timer);
      }
      handles.subscription?.dispose();
      resolve({ code, stdout, stderr });
    };

    const child = spawn(command, args, {
      cwd: cwd ?? process.cwd(),
      env: process.env,
      shell: false,
    });

    handles.timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);

    handles.subscription = token.onCancellationRequested(() => {
      child.kill();
      finish(null);
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString();
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString();
      }
    });
    child.on("error", (error: Error) => {
      stderr += error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

function trimCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      return;
    }
    cache.delete(oldest.value);
  }
}
