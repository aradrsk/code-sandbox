import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGS, runWithFallbacks, sessionDir } from "@/lib/runner";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { sessionId, language, code, stdin } = await req.json();
  const lang = LANGS[language];
  if (!lang) return NextResponse.json({ error: "unsupported language" }, { status: 400 });
  let cwd: string;
  try { cwd = sessionDir(sessionId); } catch { return NextResponse.json({ error: "bad session" }, { status: 400 }); }

  const filePath = join(cwd, lang.file);
  writeFileSync(filePath, code ?? "", "utf8");
  const candidates = lang.build(lang.file);
  const result = await runWithFallbacks(candidates, cwd, stdin);
  return NextResponse.json(result);
}
