const JUDGE0_HOST = process.env.JUDGE0_HOST || "judge0-ce.p.rapidapi.com";
const JUDGE0_URL = `https://${JUDGE0_HOST}`;
const JUDGE0_KEY = process.env.JUDGE0_KEY || "";

export const JUDGE0_LANG_ID: Record<string, number> = {
  javascript: 63,
  python:     71,
  typescript: 74,
  bash:       46,
  ruby:       72,
  go:         60,
};

export type RunResult = { stdout: string; stderr: string; code: number; killed: boolean };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

export async function judge0Execute(
  language: string,
  code: string,
  stdin?: string,
): Promise<RunResult> {
  const langId = JUDGE0_LANG_ID[language];
  if (!langId) return { stdout: "", stderr: `unsupported language: ${language}`, code: -1, killed: false };
  if (!JUDGE0_KEY) {
    return {
      stdout: "",
      stderr: "[config] JUDGE0_KEY env var is not set. Get a key at https://rapidapi.com/judge0-official/api/judge0-ce and set JUDGE0_KEY in your Vercel project.",
      code: -1,
      killed: false,
    };
  }

  const r = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-RapidAPI-Key": JUDGE0_KEY,
      "X-RapidAPI-Host": JUDGE0_HOST,
    },
    body: JSON.stringify({
      language_id: langId,
      source_code: b64(code),
      stdin: stdin ? b64(stdin) : undefined,
      cpu_time_limit: 10,
      wall_time_limit: 15,
      memory_limit: 256000,
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    return { stdout: "", stderr: `[judge0 ${r.status}] ${t}`, code: -1, killed: false };
  }
  const j = await r.json();
  const stdout = unb64(j.stdout);
  const stderr = unb64(j.stderr) + unb64(j.compile_output);
  const exitCode = typeof j.exit_code === "number" ? j.exit_code : (j.status?.id === 3 ? 0 : -1);
  const killed = j.status?.id === 5; // Time Limit Exceeded
  const statusNote = j.status && j.status.id !== 3 && j.status.id !== 4
    ? `\n[${j.status.description}]`
    : "";
  return { stdout, stderr: stderr + statusNote, code: exitCode, killed };
}
