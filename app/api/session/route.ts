import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sessionDir } from "@/lib/runner";

export const runtime = "nodejs";

export async function POST() {
  const id = randomBytes(16).toString("hex");
  sessionDir(id);
  return NextResponse.json({ id });
}
