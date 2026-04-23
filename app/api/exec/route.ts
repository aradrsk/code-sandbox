import { NextRequest, NextResponse } from "next/server";
import { judge0Execute } from "@/lib/judge0";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { command } = await req.json();
  if (!command || typeof command !== "string") {
    return NextResponse.json({ error: "missing command" }, { status: 400 });
  }
  try {
    const result = await judge0Execute("bash", command);
    return NextResponse.json({ ...result, cwd: "/judge0 (sandboxed, stateless)" });
  } catch (e: any) {
    return NextResponse.json({ stdout: "", stderr: `[exec error] ${e.message}`, code: -1, killed: false, cwd: "—" });
  }
}
