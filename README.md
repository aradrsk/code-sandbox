# Code Sandbox

Browser-based multi-language code sandbox with a shell.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Features

- Monaco editor with JS / TS / Python / Bash / Ruby / Go starters
- `Ctrl+Enter` to run
- Optional stdin input
- Shell command box that executes inside a per-session working directory (`%TMP%/code-sandbox/<id>`)
- 15s execution timeout, 200KB output cap

## Requirements

Languages run via your local interpreters — install whichever you want to use:
`node`, `python`, `bash`, `ruby`, `go`. TypeScript uses `npx tsx` (auto-fetched).

## Security

This runs commands as your user with no isolation. Run only your own code, not untrusted input. For untrusted code, wrap execution in Docker (replace `spawn` in `server.js` with `docker run --rm -v <cwd>:/work …`).
