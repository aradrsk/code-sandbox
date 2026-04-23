import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const maxDuration = 60;

const LANG_HINTS: Record<string, string> = {
  python: `The user is running Python code. Focus especially on:
- Traceback parsing: identify the exception type, the offending file/line, and the user's line that triggered it (ignore internal frames when possible).
- Common Python pitfalls: IndentationError/TabError, NameError (typos, scoping, missing imports), TypeError (wrong arg count, None arithmetic, str/int mixing), AttributeError (None, wrong type), KeyError/IndexError, ImportError/ModuleNotFoundError (suggest pip install), UnicodeDecodeError, RecursionError, ZeroDivisionError.
- Python 2 vs 3 issues (print statement, division, input vs raw_input).
- Indentation/whitespace errors — show the exact fixed snippet.
- If ModuleNotFoundError, suggest the pip install command the user can run in the shell panel.
Show a minimal corrected code snippet inline.`,
  javascript: `Node.js runtime. Parse the stack trace, identify ReferenceError/TypeError/SyntaxError. Watch for undefined/null access, async/await misuse, missing require/import, module not found (suggest npm install).`,
  typescript: `Running via tsx. Distinguish TS compile errors (TSxxxx codes) from runtime errors. For TS errors, explain the type mismatch in plain terms.`,
  bash: `Bash script. Check for: command not found (suggest install), syntax errors (missing fi/done/quotes), permission denied, unbound variables, exit codes from subcommands.`,
  ruby: `Ruby. Parse the stack trace. Watch for NoMethodError (nil), NameError, LoadError (missing gem — suggest gem install), SyntaxError.`,
  go: `Go (go run). Distinguish compile errors (undeclared name, type mismatch, unused imports/vars — Go is strict) from runtime panics (nil deref, index out of range). For unused imports/vars, show the fix.`,
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on server" }, { status: 500 });
  }

  const { language, code, stdout, stderr, exitCode } = await req.json();
  if (!stderr && exitCode === 0) {
    return NextResponse.json({ explanation: "No error detected — the program exited successfully." });
  }

  const hint = LANG_HINTS[language] ?? `Language: ${language}. Analyze the error output and explain the cause.`;

  const system = `You are an expert programming tutor helping a user debug code they just ran in a sandbox.
${hint}

Respond in this exact format:
**What went wrong:** <one or two sentences, plain English>
**Why:** <root cause>
**Fix:** <concrete fix, with a short corrected code snippet in a fenced block if useful>

Be concise. No preamble. No filler.`;

  const userMsg = `Language: ${language}
Exit code: ${exitCode}

--- CODE ---
${String(code ?? "").slice(0, 8000)}

--- STDOUT ---
${String(stdout ?? "").slice(0, 2000)}

--- STDERR ---
${String(stderr ?? "").slice(0, 4000)}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const resp = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      contents: userMsg,
      config: { systemInstruction: system },
    });
    return NextResponse.json({ explanation: resp.text ?? "(no response)" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
