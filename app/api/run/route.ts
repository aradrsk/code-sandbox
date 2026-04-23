import { NextRequest, NextResponse } from "next/server";
import { pistonExecute, PISTON_LANG } from "@/lib/piston";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { language, code, stdin } = await req.json();
  if (!PISTON_LANG[language]) {
    return NextResponse.json({ error: "unsupported language" }, { status: 400 });
  }
  try {
    const result = await pistonExecute(language, code ?? "", stdin);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ stdout: "", stderr: `[run error] ${e.message}`, code: -1, killed: false });
  }
}
