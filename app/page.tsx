"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const STARTER = "print('hello from python')\n";

type OutLine = { text: string; kind: "out" | "err" | "meta" };

function cleanPyodideTraceback(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;
  // Keep the first "Traceback" header if present
  if (lines[0]?.startsWith("Traceback")) { out.push(lines[0]); i = 1; }
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const isFrame = /^\s*File "/.test(line);
    if (isFrame) {
      const isInternal =
        /\/lib\/python[\d.]*\.zip\//.test(line) ||
        /_pyodide\/_base\.py/.test(line) ||
        /pyodide\.asm\./.test(line) ||
        /"<exec>"/.test(line);
      if (isInternal) {
        // skip this "File ..." line and the indented source line that follows
        i += 1;
        if (/^\s{4}/.test(next)) i += 1;
        // skip caret-indicator line if any
        if (/^\s*\^+\s*$/.test(lines[i] ?? "")) i += 1;
        continue;
      }
    }
    // Rewrite "<exec>" references to "your code" for clarity
    out.push(line.replace(/"<exec>"/g, '"your code"'));
    i += 1;
  }
  // Collapse consecutive blank lines
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

declare global {
  interface Window {
    loadPyodide?: (opts?: any) => Promise<any>;
  }
}

const PYODIDE_VERSION = "0.26.2";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export default function Page() {
  const [code, setCode] = useState(STARTER);
  const [stdin, setStdin] = useState("");
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [pyStatus, setPyStatus] = useState<"loading" | "ready" | "error">("loading");
  const [lastRun, setLastRun] = useState<{ stdout: string; stderr: string; code: number } | null>(null);
  const [lines, setLines] = useState<OutLine[]>([{ text: "Loading Python runtime (Pyodide)…", kind: "meta" }]);
  const pyodideRef = useRef<any>(null);
  const codeRef = useRef(code); codeRef.current = code;
  const stdinRef = useRef(stdin); stdinRef.current = stdin;
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.loadPyodide) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = PYODIDE_URL;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("failed to load pyodide.js"));
            document.head.appendChild(s);
          });
        }
        const py = await window.loadPyodide!({ indexURL: PYODIDE_INDEX });
        if (cancelled) return;
        pyodideRef.current = py;
        setPyStatus("ready");
        setLines([{ text: `Python ${py.runPython("import sys; sys.version.split()[0]")} ready. Press Ctrl+Enter to run.`, kind: "meta" }]);
      } catch (e: any) {
        if (cancelled) return;
        setPyStatus("error");
        setLines([{ text: `Failed to load Pyodide: ${e.message}`, kind: "err" }]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [lines]);

  function append(text: string, kind: OutLine["kind"] = "out") {
    setLines((ls) => [...ls, { text, kind }]);
  }

  async function run() {
    const py = pyodideRef.current;
    if (!py || pyStatus !== "ready") return;
    setBusy(true);
    let stdout = "";
    let stderr = "";
    try {
      py.setStdout({ batched: (s: string) => { stdout += s + "\n"; } });
      py.setStderr({ batched: (s: string) => { stderr += s + "\n"; } });
      if (stdinRef.current) {
        const lines = stdinRef.current.split("\n");
        let i = 0;
        py.setStdin({ stdin: () => (i < lines.length ? lines[i++] : null) });
      } else {
        py.setStdin({ stdin: () => null });
      }
      await py.loadPackagesFromImports(codeRef.current);
      await py.runPythonAsync(codeRef.current);
      setLines([]);
      if (stdout) append(stdout, "out");
      append(`\n[exit 0]\n`, "meta");
      setLastRun({ stdout, stderr: "", code: 0 });
    } catch (e: any) {
      setLines([]);
      if (stdout) append(stdout, "out");
      const raw = e?.message ?? String(e);
      const cleaned = cleanPyodideTraceback(raw);
      stderr += cleaned;
      append(cleaned + "\n", "err");
      append(`\n[exit 1]\n`, "meta");
      setLastRun({ stdout, stderr, code: 1 });
    } finally {
      setBusy(false);
    }
  }

  async function explain() {
    if (!lastRun) return;
    setExplaining(true);
    append(`\n✨ Asking AI to explain the error...\n`, "meta");
    try {
      const r = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: "python",
          code: codeRef.current,
          stdout: lastRun.stdout,
          stderr: lastRun.stderr,
          exitCode: lastRun.code,
        }),
      });
      const j = await r.json();
      if (j.error) append(`\n[AI error] ${j.error}\n`, "err");
      else append(`\n${j.explanation}\n`, "meta");
    } catch (e: any) {
      append(`\n[client error] ${e.message}\n`, "err");
    } finally {
      setExplaining(false);
    }
  }

  const hasError = !!lastRun && (lastRun.code !== 0 || !!lastRun.stderr);
  const statusLabel = pyStatus === "loading" ? "loading python" : pyStatus === "error" ? "error" : busy ? "running" : "ready";
  const statusDot = pyStatus === "loading" ? "busy" : pyStatus === "error" ? "err" : busy ? "busy" : "live";

  return (
    <div style={{ position: "relative", display: "grid", gridTemplateRows: "auto 1fr auto", height: "100vh", zIndex: 1 }}>
      <header style={{
        padding: "12px 18px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        background: "rgba(15, 18, 24, 0.7)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "var(--accent-grad)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, color: "#0b0d12", fontSize: 14,
            boxShadow: "0 2px 8px rgba(124,156,255,0.3)",
          }}>🐍</div>
          <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Python Sandbox</strong>
        </div>

        <button
          className="btn-primary"
          onClick={run}
          disabled={busy || pyStatus !== "ready"}
          style={{ padding: "6px 14px", borderRadius: 6, cursor: "pointer" }}
        >
          {busy ? "Running…" : "▶  Run"}
          <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 11, fontWeight: 500 }}>⌘↵</span>
        </button>

        <button className="btn" onClick={() => setLines([])}>Clear</button>

        <button
          className="btn"
          onClick={explain}
          disabled={!hasError || explaining}
          title={hasError ? "Ask AI to explain the error" : "Run code that errors to enable"}
          style={hasError ? { background: "linear-gradient(135deg, rgba(248,113,113,0.18), rgba(167,139,250,0.18))", borderColor: "rgba(248,113,113,0.4)" } : undefined}
        >
          {explaining ? "Thinking…" : "✨ Explain error"}
        </button>

        <span style={{ flex: 1 }} />

        <span className="pill">
          <span className={`dot ${statusDot}`} />
          {statusLabel}
        </span>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", minHeight: 0, gap: 1, background: "var(--border)" }}>
        <div style={{ minHeight: 0, background: "var(--panel)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
            Editor · Python
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language="python"
              value={code}
              onChange={(v) => setCode(v ?? "")}
              theme="vs-dark"
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                automaticLayout: true,
                fontFamily: "ui-monospace, 'JetBrains Mono', Menlo, monospace",
                fontLigatures: true,
                padding: { top: 12, bottom: 12 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                renderLineHighlight: "gutter",
              }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateRows: "1fr auto", minHeight: 0, background: "var(--panel)" }}>
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
              <span>Output</span>
              {lastRun && <span style={{ color: lastRun.code === 0 ? "var(--ok)" : "var(--err)" }}>exit {lastRun.code}</span>}
            </div>
            <div ref={outRef} style={{
              flex: 1,
              padding: "12px 14px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--mono)",
              fontSize: 13,
              lineHeight: 1.55,
              background: "#0a0c11",
            }}>
              {lines.map((l, i) => (
                <span key={i} style={{
                  color: l.kind === "err" ? "var(--err)" : l.kind === "meta" ? "var(--text-faint)" : "var(--text)",
                  fontStyle: l.kind === "meta" ? "italic" : "normal",
                }}>{l.text}</span>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-elev)" }}>
            <label style={{ color: "var(--text-faint)", fontSize: 11, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>stdin</label>
            <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false}
              placeholder="optional input for input() calls — one line per call"
              style={{ fontFamily: "var(--mono)", fontSize: 13, minHeight: 44, resize: "vertical" }} />
          </div>
        </div>
      </main>

      <footer style={{
        padding: "6px 18px",
        fontSize: 11.5,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: "var(--text-dim)",
        background: "var(--bg-elev)",
        borderTop: "1px solid var(--border)",
        fontFamily: "var(--mono)",
      }}>
        <span>🐍 runs in your browser via Pyodide</span>
        <span>no server required</span>
      </footer>
    </div>
  );
}
