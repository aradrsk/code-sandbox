import { NextRequest, NextResponse } from "next/server";
import { judge0Execute, JUDGE0_LANG_ID } from "@/lib/judge0";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { language, code, stdin } = await req.json();
  if (!(language in JUDGE0_LANG_ID)) {
    return NextResponse.json({ error: "unsupported language" }, { status: 400 });
  }
  try {
    const result = await judge0Execute(language, code ?? "", stdin);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ stdout: "", stderr: `[run error] ${e.message}`, code: -1, killed: false });
  }
}
