const PISTON_URL = process.env.PISTON_URL || "https://emkc.org/api/v2/piston";

export const PISTON_LANG: Record<string, { language: string; fileName: string }> = {
  javascript: { language: "javascript", fileName: "main.js" },
  python:     { language: "python",     fileName: "main.py" },
  typescript: { language: "typescript", fileName: "main.ts" },
  bash:       { language: "bash",       fileName: "main.sh" },
  ruby:       { language: "ruby",       fileName: "main.rb" },
  go:         { language: "go",         fileName: "main.go" },
};

type Runtime = { language: string; version: string; aliases: string[] };
let runtimesCache: Runtime[] | null = null;
let runtimesFetchedAt = 0;

async function getRuntimes(): Promise<Runtime[]> {
  const now = Date.now();
  if (runtimesCache && now - runtimesFetchedAt < 10 * 60_000) return runtimesCache;
  const r = await fetch(`${PISTON_URL}/runtimes`);
  if (!r.ok) throw new Error(`piston runtimes ${r.status}`);
  runtimesCache = await r.json();
  runtimesFetchedAt = now;
  return runtimesCache!;
}

async function resolveVersion(language: string): Promise<string> {
  const runtimes = await getRuntimes();
  const matches = runtimes.filter(
    (r) => r.language === language || r.aliases.includes(language),
  );
  if (!matches.length) throw new Error(`no piston runtime for ${language}`);
  return matches.sort((a, b) => (a.version < b.version ? 1 : -1))[0].version;
}

export type RunResult = { stdout: string; stderr: string; code: number; killed: boolean };

export async function pistonExecute(
  language: string,
  code: string,
  stdin?: string,
): Promise<RunResult> {
  const map = PISTON_LANG[language];
  if (!map) return { stdout: "", stderr: `unsupported language: ${language}`, code: -1, killed: false };

  const version = await resolveVersion(map.language);
  const r = await fetch(`${PISTON_URL}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      language: map.language,
      version,
      files: [{ name: map.fileName, content: code }],
      stdin: stdin ?? "",
      compile_timeout: 10000,
      run_timeout: 15000,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return { stdout: "", stderr: `[piston ${r.status}] ${t}`, code: -1, killed: false };
  }
  const j = await r.json();
  const run = j.run ?? {};
  const compile = j.compile ?? {};
  const stdout = (compile.stdout ?? "") + (run.stdout ?? "");
  const stderr = (compile.stderr ?? "") + (run.stderr ?? "");
  const exitCode = typeof run.code === "number" ? run.code : (typeof compile.code === "number" ? compile.code : -1);
  const killed = run.signal === "SIGKILL" || compile.signal === "SIGKILL";
  return { stdout, stderr, code: exitCode, killed };
}
