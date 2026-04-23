"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const STARTER = `# Welcome to Python Sandbox
# Runs entirely in your browser via Pyodide — no server needed.

def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("World"))
`;

const EXAMPLES: Array<{ name: string; code: string }> = [
  {
    name: "Hello world",
    code: "print('Hello, World!')\n",
  },
  {
    name: "Fibonacci",
    code: `def fib(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

print(list(fib(10)))
`,
  },
  {
    name: "NumPy matrix",
    code: `import numpy as np

m = np.arange(9).reshape(3, 3)
print(m)
print("sum:", m.sum())
print("mean:", m.mean())
`,
  },
  {
    name: "input() demo",
    code: `name = input("Your name? ")
print(f"Nice to meet you, {name}!")
`,
  },
];

type OutLine = { text: string; kind: "out" | "err" | "meta" };

function cleanPyodideTraceback(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let i = 0;
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
        i += 1;
        if (/^\s{4}/.test(next)) i += 1;
        if (/^\s*\^+\s*$/.test(lines[i] ?? "")) i += 1;
        continue;
      }
    }
    out.push(line.replace(/"<exec>"/g, '"your code"'));
    i += 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

declare global {
  interface Window { loadPyodide?: (opts?: any) => Promise<any>; }
}

const PYODIDE_VERSION = "0.26.2";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

function PythonLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 111 110" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="py-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5A9FD4" />
          <stop offset="100%" stopColor="#306998" />
        </linearGradient>
        <linearGradient id="py-yellow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFE873" />
          <stop offset="100%" stopColor="#FFC331" />
        </linearGradient>
      </defs>
      <path fill="url(#py-blue)" d="M54.9.5c-4.6 0-9 .4-12.9 1.1-11.4 2-13.5 6.3-13.5 14v10.1h27v3.4H18.3c-7.8 0-14.6 4.7-16.7 13.5-2.5 10.2-2.6 16.5 0 27.1 1.9 7.9 6.4 13.5 14.2 13.5h9.3V70.1c0-8.8 7.7-16.7 16.7-16.7h27c7.5 0 13.5-6.2 13.5-13.7V15.6c0-7.3-6.2-12.8-13.5-14C63.8.9 59.4.5 54.9.5zM40.2 8.8c2.8 0 5.1 2.3 5.1 5.1s-2.3 5.1-5.1 5.1-5.1-2.3-5.1-5.1 2.3-5.1 5.1-5.1z"/>
      <path fill="url(#py-yellow)" d="M85.6 28.7v12.5c0 9.2-7.8 16.9-16.7 16.9h-27c-7.4 0-13.5 6.3-13.5 13.7v25.7c0 7.3 6.4 11.6 13.5 13.7 8.5 2.5 16.7 3 27 0 6.8-2 13.5-5.9 13.5-13.7V87.3H55.4v-3.4h40.3c7.8 0 10.7-5.5 13.5-13.5 2.8-8.3 2.7-16.3 0-27.1-1.9-7.7-5.7-13.5-13.5-13.5h-9.3zM70.3 91.2c2.8 0 5.1 2.3 5.1 5.1s-2.3 5.1-5.1 5.1-5.1-2.3-5.1-5.1 2.3-5.1 5.1-5.1z"/>
    </svg>
  );
}

type Theme = "dark" | "light";

export default function Page() {
  const [theme, setTheme] = useState<Theme>("light");
  const [code, setCode] = useState(STARTER);
  const [stdin, setStdin] = useState("");
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [pyStatus, setPyStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pyVersion, setPyVersion] = useState<string>("");
  const [loadProgress, setLoadProgress] = useState<string>("");
  const [lastRun, setLastRun] = useState<{ stdout: string; stderr: string; code: number; durationMs: number } | null>(null);
  const [lines, setLines] = useState<OutLine[]>([{ text: "Loading Python runtime…", kind: "meta" }]);
  const [showExamples, setShowExamples] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toast, setToast] = useState<string>("");
  const [fontSize, setFontSize] = useState(14);
  const [wordWrap, setWordWrap] = useState(false);
  const [pkgInput, setPkgInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const pyodideRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef(code); codeRef.current = code;
  const stdinRef = useRef(stdin); stdinRef.current = stdin;
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("theme")) as Theme | null;
    const initial: Theme = saved ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  // Load initial code: URL hash (shared), then localStorage, else STARTER.
  useEffect(() => {
    try {
      const hash = window.location.hash;
      if (hash.startsWith("#code=")) {
        const decoded = decodeURIComponent(escape(atob(hash.slice(6).replace(/-/g, "+").replace(/_/g, "/"))));
        setCode(decoded);
        return;
      }
      const saved = localStorage.getItem("code");
      if (saved) setCode(saved);
    } catch {}
  }, []);

  // Autosave code (debounced).
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem("code", code); } catch {} }, 400);
    return () => clearTimeout(t);
  }, [code]);

  // Font size persist.
  useEffect(() => {
    const s = Number(localStorage.getItem("fontSize") || 0);
    if (s >= 10 && s <= 24) setFontSize(s);
    const w = localStorage.getItem("wordWrap");
    if (w === "1") setWordWrap(true);
  }, []);
  useEffect(() => { try { localStorage.setItem("fontSize", String(fontSize)); } catch {} }, [fontSize]);
  useEffect(() => { try { localStorage.setItem("wordWrap", wordWrap ? "1" : "0"); } catch {} }, [wordWrap]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadProgress("downloading runtime");
        if (!window.loadPyodide) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = PYODIDE_URL;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("failed to load pyodide.js"));
            document.head.appendChild(s);
          });
        }
        setLoadProgress("initializing interpreter");
        const py = await window.loadPyodide!({ indexURL: PYODIDE_INDEX });
        if (cancelled) return;
        const version = py.runPython("import sys; sys.version.split()[0]");
        pyodideRef.current = py;
        setPyVersion(version);
        setPyStatus("ready");
        setLines([{ text: `Python ${version} ready. Press `, kind: "meta" }, { text: "Ctrl+Enter", kind: "out" }, { text: " to run your code.", kind: "meta" }]);
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
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter") { e.preventDefault(); run(); }
      else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); downloadFile(); }
      else if (mod && e.key === "/") { e.preventDefault(); setShowShortcuts((s) => !s); }
      else if (e.key === "Escape") { setShowShortcuts(false); setShowExamples(false); }
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
    const started = performance.now();
    let stdout = "";
    let stderr = "";
    try {
      py.setStdout({ batched: (s: string) => { stdout += s + "\n"; } });
      py.setStderr({ batched: (s: string) => { stderr += s + "\n"; } });
      if (stdinRef.current) {
        const inputLines = stdinRef.current.split("\n");
        let i = 0;
        py.setStdin({ stdin: () => (i < inputLines.length ? inputLines[i++] : null) });
      } else {
        py.setStdin({ stdin: () => null });
      }
      await py.loadPackagesFromImports(codeRef.current);
      await py.runPythonAsync(codeRef.current);
      const duration = Math.round(performance.now() - started);
      setLines([]);
      if (stdout) append(stdout, "out");
      append(`\n✓ Ran successfully in ${duration}ms\n`, "meta");
      setLastRun({ stdout, stderr: "", code: 0, durationMs: duration });
    } catch (e: any) {
      const duration = Math.round(performance.now() - started);
      setLines([]);
      if (stdout) append(stdout, "out");
      const cleaned = cleanPyodideTraceback(e?.message ?? String(e));
      stderr += cleaned;
      append(cleaned + "\n", "err");
      if (/EOFError.*reading a line/i.test(cleaned)) {
        append(`\n💡 Your code called input() but the stdin box is empty. Type the input below — one line per input() call — then Run again.\n`, "meta");
      }
      append(`\n✗ Errored after ${duration}ms\n`, "meta");
      setLastRun({ stdout, stderr, code: 1, durationMs: duration });
    } finally {
      setBusy(false);
    }
  }

  function downloadFile() {
    const blob = new Blob([codeRef.current], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "main.py";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Downloaded main.py");
  }

  function uploadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setCode(String(reader.result ?? ""));
      showToast(`Loaded ${file.name}`);
    };
    reader.readAsText(file);
  }

  async function shareLink() {
    try {
      const b64 = btoa(unescape(encodeURIComponent(codeRef.current))).replace(/\+/g, "-").replace(/\//g, "_");
      const url = `${window.location.origin}${window.location.pathname}#code=${b64}`;
      await navigator.clipboard.writeText(url);
      showToast("Share link copied to clipboard");
    } catch (e: any) {
      showToast(`Copy failed: ${e.message}`);
    }
  }

  function resetCode() {
    if (confirm("Reset editor to starter code? (your current code will be lost)")) {
      setCode(STARTER);
      showToast("Reset to starter");
    }
  }

  async function installPackages() {
    const py = pyodideRef.current;
    if (!py || pyStatus !== "ready") return;
    const names = pkgInput.trim().split(/\s+/).filter(Boolean);
    if (!names.length) return;
    setInstalling(true);
    append(`\n📦 Installing ${names.join(", ")} via micropip...\n`, "meta");
    try {
      await py.loadPackage("micropip");
      const micropip = py.pyimport("micropip");
      for (const name of names) {
        await micropip.install(name);
        append(`  ✓ ${name}\n`, "meta");
      }
      append(`Done. You can now \`import\` them.\n`, "meta");
      setPkgInput("");
    } catch (e: any) {
      append(`  ✗ ${e.message}\n`, "err");
    } finally {
      setInstalling(false);
    }
  }

  async function explain() {
    if (!lastRun) return;
    setExplaining(true);
    append(`\n✨ Asking AI to explain...\n`, "meta");
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
  const statusLabel = pyStatus === "loading" ? loadProgress || "loading" : pyStatus === "error" ? "error" : busy ? "running" : "ready";
  const statusDot = pyStatus === "loading" ? "busy" : pyStatus === "error" ? "err" : busy ? "busy" : "live";

  return (
    <div style={{ position: "relative", display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", zIndex: 1 }}>
      <header style={{
        padding: "14px 22px",
        display: "flex",
        gap: 12,
        alignItems: "center",
        background: theme === "dark" ? "rgba(7, 9, 15, 0.6)" : "rgba(255, 255, 255, 0.7)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--border)",
        position: "relative",
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginRight: 4 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
              position: "absolute", inset: -6, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255, 212, 59, 0.25), transparent 70%)",
              filter: "blur(8px)",
            }} />
            <PythonLogo size={30} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <strong style={{ fontSize: 15, letterSpacing: "-0.015em", fontWeight: 650 }}>Python Sandbox</strong>
            <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
              {pyVersion ? `v${pyVersion} · in-browser` : "loading…"}
            </span>
          </div>
        </div>

        <span style={{ width: 1, height: 24, background: "var(--border)", margin: "0 6px" }} />

        <button
          className="btn-primary"
          onClick={run}
          disabled={busy || pyStatus !== "ready"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {busy ? "Running…" : "Run"}
          <span className="kbd">⌘↵</span>
        </button>

        <div style={{ position: "relative" }}>
          <button className="btn" onClick={() => setShowExamples((s) => !s)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Examples
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {showExamples && (
            <>
              <div onClick={() => setShowExamples(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
              <div style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                background: "var(--panel-2)",
                border: "1px solid var(--border-strong)",
                borderRadius: 10,
                minWidth: 200,
                padding: 6,
                boxShadow: "0 20px 40px -10px rgba(0,0,0,0.6)",
                animation: "fadeInUp 0.15s ease",
                zIndex: 21,
              }}>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.name}
                    onClick={() => { setCode(ex.code); setShowExamples(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 12px", background: "transparent", border: "none",
                      borderRadius: 6, color: "var(--text)", cursor: "pointer",
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button className="btn" onClick={shareLink} title="Copy a shareable link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>

        <button className="btn" onClick={downloadFile} title="Download as main.py (Ctrl+S)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>

        <button className="btn" onClick={() => fileInputRef.current?.click()} title="Upload .py file">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".py,text/x-python,text/plain"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
        />

        <button className="btn-ghost" onClick={() => setLines([])} title="Clear output console">Clear</button>

        {hasError && (
          <button className="btn btn-ai" onClick={explain} disabled={explaining}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.09 6.26L20 10l-4.91 3.74L16.18 20 12 16.54 7.82 20l1.09-6.26L4 10l5.91-1.74z"/></svg>
            {explaining ? "Thinking…" : "Explain error"}
          </button>
        )}

        <span style={{ flex: 1 }} />

        <button
          className="btn-ghost"
          onClick={() => setShowShortcuts(true)}
          title="Keyboard shortcuts (Ctrl+/)"
          style={{ padding: "8px 10px" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>
        </button>

        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>

        <a href="https://github.com/aradrsk/code-sandbox" target="_blank" rel="noreferrer" className="btn-ghost" style={{ textDecoration: "none" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.53-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18.92-.26 1.9-.39 2.88-.39s1.96.13 2.88.39c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.26 5.69.41.35.77 1.05.77 2.12v3.15c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5z"/></svg>
        </a>

        <span className="pill">
          <span className={`dot ${statusDot}`} />
          {statusLabel}
        </span>
      </header>

      <main style={{
        display: "grid",
        gridTemplateColumns: "1.5fr 1fr",
        gap: 14,
        padding: 14,
        minHeight: 0,
      }}>
        <section className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="panel-head">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              Editor
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none", letterSpacing: 0 }}>
              <button
                className="btn-ghost"
                onClick={() => setFontSize((s) => Math.max(10, s - 1))}
                title="Decrease font size"
                style={{ padding: "2px 6px", fontSize: 13, fontWeight: 600 }}
              >A−</button>
              <button
                className="btn-ghost"
                onClick={() => setFontSize((s) => Math.min(24, s + 1))}
                title="Increase font size"
                style={{ padding: "2px 6px", fontSize: 13, fontWeight: 600 }}
              >A+</button>
              <button
                className="btn-ghost"
                onClick={() => setWordWrap((w) => !w)}
                title="Toggle word wrap"
                style={{ padding: "2px 6px", fontSize: 11, fontWeight: 600, color: wordWrap ? "var(--accent)" : undefined }}
              >WRAP</button>
              <button
                className="btn-ghost"
                onClick={resetCode}
                title="Reset to starter code"
                style={{ padding: "2px 6px", fontSize: 11, fontWeight: 600 }}
              >RESET</button>
              <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-faint)", marginLeft: 4 }}>main.py</span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language="python"
              value={code}
              onChange={(v) => setCode(v ?? "")}
              theme={theme === "dark" ? "vs-dark" : "vs"}
              options={{
                fontSize,
                wordWrap: wordWrap ? "on" : "off",
                minimap: { enabled: false },
                automaticLayout: true,
                fontFamily: "var(--font-mono), ui-monospace, 'JetBrains Mono', Menlo, monospace",
                fontLigatures: true,
                padding: { top: 14, bottom: 14 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                renderLineHighlight: "gutter",
                lineNumbersMinChars: 3,
                folding: true,
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateRows: "1fr auto", gap: 14, minHeight: 0 }}>
          <div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="panel-head">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                Output
              </span>
              {lastRun && (
                <span style={{ display: "flex", gap: 10, alignItems: "center", textTransform: "none", letterSpacing: 0, fontFamily: "var(--mono)", fontSize: 11 }}>
                  <span style={{ color: lastRun.code === 0 ? "var(--ok)" : "var(--err)" }}>
                    {lastRun.code === 0 ? "✓ success" : "✗ error"}
                  </span>
                  <span style={{ color: "var(--text-faint)" }}>·</span>
                  <span style={{ color: "var(--text-faint)" }}>{lastRun.durationMs}ms</span>
                </span>
              )}
            </div>
            <div ref={outRef} style={{
              flex: 1,
              padding: "14px 18px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--mono)",
              fontSize: 13,
              lineHeight: 1.6,
              background: "var(--output-bg)",
            }}>
              {lines.map((l, i) => (
                <span key={i} style={{
                  color: l.kind === "err" ? "var(--err)" : l.kind === "meta" ? "var(--text-faint)" : "var(--text)",
                  fontStyle: l.kind === "meta" ? "italic" : "normal",
                }}>{l.text}</span>
              ))}
            </div>
          </div>

          <div className="panel" style={{ padding: "12px 16px" }}>
            <label style={{
              display: "flex", alignItems: "center", gap: 6,
              color: "var(--text-faint)", fontSize: 11, marginBottom: 8,
              textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 600,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              stdin
            </label>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              spellCheck={false}
              placeholder="optional — one line per input() call"
              style={{ fontFamily: "var(--mono)", fontSize: 13, minHeight: 52, resize: "vertical", width: "100%" }}
            />
          </div>

          <div className="panel" style={{ padding: "12px 16px" }}>
            <label style={{
              display: "flex", alignItems: "center", gap: 6,
              color: "var(--text-faint)", fontSize: 11, marginBottom: 8,
              textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 600,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              pip install
            </label>
            <form
              onSubmit={(e) => { e.preventDefault(); installPackages(); }}
              style={{ display: "flex", gap: 6 }}
            >
              <input
                value={pkgInput}
                onChange={(e) => setPkgInput(e.target.value)}
                placeholder="e.g. requests beautifulsoup4"
                disabled={installing || pyStatus !== "ready"}
                style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13 }}
              />
              <button type="submit" className="btn" disabled={installing || pyStatus !== "ready" || !pkgInput.trim()}>
                {installing ? "…" : "Install"}
              </button>
            </form>
          </div>
        </section>
      </main>

      {toast && (
        <div style={{
          position: "fixed",
          bottom: 22,
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--panel-2)",
          border: "1px solid var(--border-strong)",
          padding: "10px 18px",
          borderRadius: 10,
          boxShadow: "var(--shadow)",
          fontSize: 13,
          color: "var(--text)",
          animation: "fadeInUp 0.2s ease",
          zIndex: 100,
        }}>
          {toast}
        </div>
      )}

      {showShortcuts && (
        <>
          <div
            onClick={() => setShowShortcuts(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, backdropFilter: "blur(4px)" }}
          />
          <div style={{
            position: "fixed",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            background: "var(--panel)",
            border: "1px solid var(--border-strong)",
            borderRadius: 14,
            padding: 24,
            minWidth: 340,
            boxShadow: "0 40px 80px -20px rgba(0,0,0,0.6)",
            zIndex: 51,
            animation: "fadeInUp 0.18s ease",
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Keyboard Shortcuts</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[
                  ["Run code", "⌘↵ / Ctrl+Enter"],
                  ["Download as .py", "⌘S / Ctrl+S"],
                  ["Toggle shortcuts", "⌘/ / Ctrl+/"],
                  ["Close dialogs", "Esc"],
                ].map(([label, keys]) => (
                  <tr key={label}>
                    <td style={{ padding: "8px 0", color: "var(--text-dim)" }}>{label}</td>
                    <td style={{ padding: "8px 0", textAlign: "right" }}><span className="kbd">{keys}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn" onClick={() => setShowShortcuts(false)} style={{ width: "100%", marginTop: 16, justifyContent: "center" }}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}
