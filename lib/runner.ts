import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

export const ROOT = join(tmpdir(), "code-sandbox");
mkdirSync(ROOT, { recursive: true });

export const RUN_TIMEOUT_MS = 15_000;
export const MAX_OUTPUT_BYTES = 200_000;

export type Lang = {
  file: string;
  build: (file: string) => Array<[string, string[]]>;
};

export const LANGS: Record<string, Lang> = {
  javascript: { file: "main.js", build: (f) => [["node", [f]]] },
  python:     { file: "main.py", build: (f) => [["python3", [f]], ["python", [f]], ["/usr/bin/python3", [f]], ["py", ["-3", f]]] },
  typescript: { file: "main.ts", build: (f) => [["npx", ["-y", "tsx", f]]] },
  bash:       { file: "main.sh", build: (f) => [["bash", [f]]] },
  ruby:       { file: "main.rb", build: (f) => [["ruby", [f]]] },
  go:         { file: "main.go", build: (f) => [["go", ["run", f]]] },
};

export function sessionDir(id: string): string {
  if (!/^[a-f0-9]{16,64}$/.test(id || "")) throw new Error("invalid session id");
  const dir = resolve(ROOT, id);
  if (!dir.startsWith(ROOT)) throw new Error("path escape");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export type RunResult = { stdout: string; stderr: string; code: number; killed: boolean };

export async function runWithFallbacks(candidates: Array<[string, string[]]>, cwd: string, stdin?: string): Promise<RunResult> {
  let last: RunResult | null = null;
  for (const [cmd, args] of candidates) {
    const r = await runProcess(cmd, args, cwd, stdin);
    last = r;
    const enoent = r.code === -1 && /ENOENT/.test(r.stderr);
    if (!enoent) return r;
  }
  return last!;
}

export function runProcess(cmd: string, args: string[], cwd: string, stdin?: string): Promise<RunResult> {
  return new Promise((resolveP) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let killed = false;

    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);

    const append = (chunk: Buffer, which: "out" | "err") => {
      bytes += chunk.length;
      const text = chunk.toString("utf8");
      if (which === "out") stdout += text; else stderr += text;
      if (bytes > MAX_OUTPUT_BYTES) {
        killed = true;
        child.kill("SIGKILL");
      }
    };

    child.stdout.on("data", (c) => append(c, "out"));
    child.stderr.on("data", (c) => append(c, "err"));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolveP({ stdout, stderr: stderr + `\n[spawn error] ${err.message}`, code: -1, killed });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ stdout, stderr, code: code ?? -1, killed });
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}
