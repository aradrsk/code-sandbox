# Code Sandbox (Next.js)

Browser-based multi-language code sandbox with a shell, built on Next.js (App Router).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Features

- Monaco editor with JS / TS / Python / Bash / Ruby / Go starters
- `Ctrl+Enter` runs current code
- Optional stdin
- Shell box that executes inside a per-session working directory (`%TMP%/code-sandbox/<id>`)
- 15s execution timeout, 200KB output cap

API routes:
- `POST /api/session` → `{ id }`
- `POST /api/run` → `{ sessionId, language, code, stdin? }`
- `POST /api/exec` → `{ sessionId, command }`

## Requirements

Code runs via your local interpreters — install whichever you need: `node`, `python`, `bash`, `ruby`, `go`. TypeScript uses `npx tsx` (auto-fetched on first run).

## Security

Runs commands as your user with no isolation. For untrusted code, swap `spawn` in [lib/runner.ts](lib/runner.ts) for a `docker run --rm -v <cwd>:/work …` invocation.
