import { NextRequest, NextResponse } from "next/server";
import { runProcess, sessionDir } from "@/lib/runner";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { sessionId, command } = await req.json();
  if (!command || typeof command !== "string") {
    return NextResponse.json({ error: "missing command" }, { status: 400 });
  }
  let cwd: string;
  try { cwd = sessionDir(sessionId); } catch { return NextResponse.json({ error: "bad session" }, { status: 400 }); }

  const isWin = process.platform === "win32";
  const [cmd, args]: [string, string[]] = isWin
    ? ["cmd.exe", ["/d", "/s", "/c", command]]
    : ["bash", ["-lc", command]];
  const result = await runProcess(cmd, args, cwd);
  return NextResponse.json({ ...result, cwd });
}
