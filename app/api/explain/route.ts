import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMsg = { role: "user" | "assistant"; content: string };

const PY_SYSTEM = `You are an expert Python tutor helping a user with code they're running in a browser-based Pyodide sandbox.

When asked to explain an error, respond in this format:
**What went wrong:** <one or two sentences, plain English>
**Why:** <root cause>
**Fix:** <concrete fix, with a short corrected code snippet in a fenced block if useful>

For follow-up questions, answer helpfully and concisely. Use markdown (**bold**, # headers, \`code\`, fenced blocks). No preamble, no filler.

The sandbox runs Python via Pyodide in the browser — remind the user of this if they ask about installing packages (use micropip.install in the "pip install" panel). No filesystem persistence across runs. No network inside the Python process (but HTTP works via pyodide.http).`;

function buildContext(args: { code: string; stdout: string; stderr: string; exitCode: number }) {
  return `## Last run context
Exit code: ${args.exitCode}

--- CODE ---
${String(args.code ?? "").slice(0, 8000)}

--- STDOUT ---
${String(args.stdout ?? "").slice(0, 2000)}

--- STDERR ---
${String(args.stderr ?? "").slice(0, 4000)}`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on server" }, { status: 500 });
  }

  const body = await req.json();
  const { code, stdout, stderr, exitCode, messages } = body as {
    code?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    messages?: ChatMsg[];
  };

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

    if (Array.isArray(messages) && messages.length > 0) {
      // Chat mode
      const context = buildContext({
        code: code ?? "",
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: exitCode ?? 0,
      });
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const resp = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction: `${PY_SYSTEM}\n\n${context}` },
      });
      return NextResponse.json({ reply: resp.text ?? "(no response)" });
    }

    // Legacy one-shot explain
    if (!stderr && exitCode === 0) {
      return NextResponse.json({ explanation: "No error detected — the program exited successfully." });
    }
    const userMsg = `Please explain this error.\n\n${buildContext({
      code: code ?? "",
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: exitCode ?? 0,
    })}`;
    const resp = await ai.models.generateContent({
      model,
      contents: userMsg,
      config: { systemInstruction: PY_SYSTEM },
    });
    return NextResponse.json({ explanation: resp.text ?? "(no response)" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
