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
  const [lines, setLines] = useState<OutLine[]>([{ text: "Output will appear here.", kind: "meta" }]);
  const codeRef = useRef(code);
  codeRef.current = code;
  const stdinRef = useRef(stdin);
  stdinRef.current = stdin;
  const langRef = useRef(language);
  langRef.current = language;
  const sidRef = useRef("");

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
    append(`\n[asking AI to explain the error...]\n`, "meta");
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
    if (!code.trim() || confirm(`Replace editor with starter snippet for ${l}?`)) setCode(STARTERS[l]);
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", height: "100vh" }}>
      <header style={{ padding: "8px 12px", background: "#252526", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #333" }}>
        <strong>Code Sandbox</strong>
        <select value={language} onChange={(e) => changeLang(e.target.value)} style={ctrl}>
          {Object.keys(STARTERS).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={run} disabled={busy} style={{ ...ctrl, background: "#0e639c", borderColor: "#1177bb", cursor: "pointer" }}>
          {busy ? "Running…" : "▶ Run (Ctrl+Enter)"}
        </button>
        <button onClick={() => setLines([])} style={{ ...ctrl, cursor: "pointer" }}>Clear output</button>
        <button
          onClick={explain}
          disabled={!hasError || explaining}
          title={hasError ? "Ask AI to explain the error" : "Run code that errors to enable"}
          style={{ ...ctrl, background: hasError ? "#8b3a3a" : "#333", borderColor: hasError ? "#b04a4a" : "#444", cursor: hasError ? "pointer" : "not-allowed" }}
        >
          {explaining ? "Thinking…" : "✨ Explain error (AI)"}
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ color: "#9c9" }}>{busy ? "running…" : "ready"}</span>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", minHeight: 0 }}>
        <div style={{ minHeight: 0, borderRight: "1px solid #333" }}>
          <Editor
            height="100%"
            language={MONACO_LANG[language]}
            value={code}
            onChange={(v) => setCode(v ?? "")}
            theme="vs-dark"
            options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateRows: "1fr auto auto", minHeight: 0 }}>
          <div style={{ padding: "10px 12px", overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, Consolas, monospace", background: "#111" }}>
            {lines.map((l, i) => (
              <span key={i} style={{ color: l.kind === "err" ? "#f48771" : l.kind === "meta" ? "#8a8a8a" : undefined }}>{l.text}</span>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: 8, background: "#252526", borderTop: "1px solid #333" }}>
            <label style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>stdin (optional)</label>
            <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false}
              style={{ background: "#1e1e1e", color: "#eee", border: "1px solid #444", padding: "6px 10px", borderRadius: 4, fontFamily: "ui-monospace, Menlo, Consolas, monospace", minHeight: 48, resize: "vertical" }} />
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); const v = cmd.trim(); if (v) { setCmd(""); exec(v); } }}
            style={{ display: "flex", gap: 6, padding: 8, background: "#252526", borderTop: "1px solid #333" }}
          >
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} autoComplete="off"
              placeholder="$ shell command in session workdir (e.g. ls, pip install requests)"
              style={{ flex: 1, background: "#1e1e1e", color: "#eee", border: "1px solid #444", padding: "6px 10px", borderRadius: 4, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }} />
            <button type="submit" style={{ ...ctrl, cursor: "pointer" }}>Exec</button>
          </form>
        </div>
      </main>

      <footer style={{ padding: "4px 10px", background: "#007acc", color: "white", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
        <span>workdir: {cwd}</span>
        <span>session: {sessionId.slice(0, 8) || "—"}</span>
      </footer>
    </div>
  );
}

const ctrl: React.CSSProperties = { background: "#333", color: "#eee", border: "1px solid #444", padding: "6px 10px", borderRadius: 4, font: "inherit" };
