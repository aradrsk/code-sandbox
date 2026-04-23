"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const STARTERS: Record<string, string> = {
  javascript: "console.log('hello from node', process.version);\n",
  python:     "print('hello from python')\n",
  typescript: "const msg: string = 'hello from ts';\nconsole.log(msg);\n",
  bash:       "echo \"hello from bash, pwd=$(pwd)\"\n",
  ruby:       "puts 'hello from ruby'\n",
  go:         "package main\nimport \"fmt\"\nfunc main() { fmt.Println(\"hello from go\") }\n",
};
const MONACO_LANG: Record<string, string> = {
  javascript: "javascript", python: "python", typescript: "typescript",
  bash: "shell", ruby: "ruby", go: "go",
};
const LANG_LABEL: Record<string, string> = {
  javascript: "JavaScript", python: "Python", typescript: "TypeScript",
  bash: "Bash", ruby: "Ruby", go: "Go",
};

type OutLine = { text: string; kind: "out" | "err" | "meta" };

export default function Page() {
  const [sessionId, setSessionId] = useState<string>("");
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(STARTERS.javascript);
  const [stdin, setStdin] = useState("");
  const [cmd, setCmd] = useState("");
  const [cwd, setCwd] = useState("—");
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [lastRun, setLastRun] = useState<{ stdout: string; stderr: string; code: number } | null>(null);
  const [lines, setLines] = useState<OutLine[]>([{ text: "Output will appear here. Press Ctrl+Enter to run.", kind: "meta" }]);
  const codeRef = useRef(code); codeRef.current = code;
  const stdinRef = useRef(stdin); stdinRef.current = stdin;
  const langRef = useRef(language); langRef.current = language;
  const sidRef = useRef("");
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/session", { method: "POST" })
      .then((r) => r.json())
      .then((j) => { setSessionId(j.id); sidRef.current = j.id; });
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
    if (!sidRef.current) return;
    setBusy(true);
    try {
      const r = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sidRef.current, language: langRef.current, code: codeRef.current, stdin: stdinRef.current }),
      });
      const j = await r.json();
      setLines([]);
      if (j.stdout) append(j.stdout, "out");
      if (j.stderr) append(j.stderr, "err");
      append(`\n[exit ${j.code}${j.killed ? ", killed (timeout/output limit)" : ""}]\n`, "meta");
      setLastRun({ stdout: j.stdout ?? "", stderr: j.stderr ?? "", code: j.code });
    } catch (e: any) {
      append(`\n[client error] ${e.message}\n`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function exec(command: string) {
    if (!sidRef.current) return;
    append(`\n$ ${command}\n`, "meta");
    try {
      const r = await fetch("/api/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sidRef.current, command }),
      });
      const j = await r.json();
      if (j.stdout) append(j.stdout, "out");
      if (j.stderr) append(j.stderr, "err");
      append(`[exit ${j.code}${j.killed ? ", killed" : ""}]\n`, "meta");
      if (j.cwd) setCwd(j.cwd);
    } catch (e: any) {
      append(`[client error] ${e.message}\n`, "err");
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
          language: langRef.current,
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

  function changeLang(l: string) {
    setLanguage(l);
    if (!code.trim() || confirm(`Replace editor with starter snippet for ${LANG_LABEL[l]}?`)) setCode(STARTERS[l]);
  }

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
            fontWeight: 800, color: "#0b0d12", fontSize: 12,
            boxShadow: "0 2px 8px rgba(124,156,255,0.3)",
            fontFamily: "var(--mono)",
          }}>{"</>"}</div>
          <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Code Sandbox</strong>
        </div>

        <select value={language} onChange={(e) => changeLang(e.target.value)}>
          {Object.keys(STARTERS).map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
        </select>

        <button className="btn-primary" onClick={run} disabled={busy} style={{ padding: "6px 14px", borderRadius: 6, cursor: "pointer" }}>
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
          <span className={`dot ${busy ? "busy" : "live"}`} />
          {busy ? "running" : "ready"}
        </span>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", minHeight: 0, gap: 1, background: "var(--border)" }}>
        <div style={{ minHeight: 0, background: "var(--panel)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
            Editor · {LANG_LABEL[language]}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language={MONACO_LANG[language]}
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

        <div style={{ display: "grid", gridTemplateRows: "1fr auto auto", minHeight: 0, background: "var(--panel)" }}>
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
              placeholder="optional input piped to the program"
              style={{ fontFamily: "var(--mono)", fontSize: 13, minHeight: 44, resize: "vertical" }} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); const v = cmd.trim(); if (v) { setCmd(""); exec(v); } }}
            style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-elev)", alignItems: "center" }}
          >
            <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 600 }}>$</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} autoComplete="off"
              placeholder="shell command (e.g. ls, pip install requests)"
              style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13 }} />
            <button type="submit" className="btn">Exec</button>
          </form>
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
        <span>📁 {cwd}</span>
        <span>session: {sessionId.slice(0, 8) || "—"}</span>
      </footer>
    </div>
  );
}
