import express from "express";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(__dirname, "public")));

const ROOT = join(tmpdir(), "code-sandbox");
mkdirSync(ROOT, { recursive: true });

const RUN_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 200_000;

// language -> { file, cmd, args(file) }
const LANGS = {
  javascript: {
    file: "main.js",
    build: (file) => ["node", [file]],
  },
  python: {
    file: "main.py",
    build: (file) => ["python", [file]],
  },
  typescript: {
    file: "main.ts",
    build: (file) => ["npx", ["-y", "tsx", file]],
  },
  bash: {
    file: "main.sh",
    build: (file) => ["bash", [file]],
  },
  ruby: {
    file: "main.rb",
    build: (file) => ["ruby", [file]],
  },
  go: {
    file: "main.go",
    build: (file) => ["go", ["run", file]],
  },
};

function sessionDir(id) {
  if (!/^[a-f0-9]{16,64}$/.test(id || "")) {
    throw new Error("invalid session id");
  }
  const dir = resolve(ROOT, id);
  if (!dir.startsWith(ROOT)) throw new Error("path escape");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function runProcess(cmd, args, cwd, stdin) {
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

    const append = (chunk, which) => {
      bytes += chunk.length;
      const text = chunk.toString("utf8");
      if (which === "out") stdout += text;
      else stderr += text;
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
      resolveP({ stdout, stderr, code, killed });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

app.post("/api/session", (_req, res) => {
  const id = randomBytes(16).toString("hex");
  sessionDir(id);
  res.json({ id });
});

app.post("/api/run", async (req, res) => {
  const { sessionId, language, code, stdin } = req.body || {};
  const lang = LANGS[language];
  if (!lang) return res.status(400).json({ error: "unsupported language" });
  let cwd;
  try { cwd = sessionDir(sessionId); } catch { return res.status(400).json({ error: "bad session" }); }

  const filePath = join(cwd, lang.file);
  writeFileSync(filePath, code ?? "", "utf8");
  const [cmd, args] = lang.build(lang.file);
  const result = await runProcess(cmd, args, cwd, stdin);
  res.json(result);
});

app.post("/api/exec", async (req, res) => {
  const { sessionId, command } = req.body || {};
  if (!command || typeof command !== "string") return res.status(400).json({ error: "missing command" });
  let cwd;
  try { cwd = sessionDir(sessionId); } catch { return res.status(400).json({ error: "bad session" }); }

  const isWin = process.platform === "win32";
  const [cmd, args] = isWin
    ? ["cmd.exe", ["/d", "/s", "/c", command]]
    : ["bash", ["-lc", command]];
  const result = await runProcess(cmd, args, cwd);
  res.json({ ...result, cwd });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Code sandbox listening at http://localhost:${PORT}`);
  console.log(`Workdir root: ${ROOT}`);
});
