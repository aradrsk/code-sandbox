// Pyodide worker with blocking stdin via SharedArrayBuffer.
// Messages in:
//   { type: "init" }
//   { type: "run", code: string, sab: SharedArrayBuffer, dataSab: SharedArrayBuffer }
//   { type: "install", packages: string[] }
// Messages out:
//   { type: "ready", version }
//   { type: "stdout", text } | { type: "stderr", text }
//   { type: "stdin-request", prompt }
//   { type: "done", durationMs } | { type: "error", message, durationMs }
//   { type: "install-done" } | { type: "install-error", message }

const PYODIDE_VERSION = "0.26.2";
self.importScripts(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`);

let pyodide = null;

const MPL_PATCH = `
import os
os.environ["MPLBACKEND"] = "AGG"

def _sandbox_install_mpl_hook():
    try:
        import matplotlib
        matplotlib.use("AGG")
        import matplotlib.pyplot as plt
        import io, base64, sys
        _orig_show = plt.show
        def _capture_show(*a, **kw):
            for num in plt.get_fignums():
                fig = plt.figure(num)
                buf = io.BytesIO()
                fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
                buf.seek(0)
                b64 = base64.b64encode(buf.read()).decode()
                sys.stdout.write("\\x1b__SANDBOX_IMG__" + b64 + "\\x1b__END_IMG__\\n")
                sys.stdout.flush()
            plt.close("all")
        plt.show = _capture_show
    except ImportError:
        pass

_sandbox_install_mpl_hook()
`;

async function init() {
  pyodide = await loadPyodide({
    indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
  });
  const version = pyodide.runPython("import sys; sys.version.split()[0]");
  self.postMessage({ type: "ready", version });
}

// control SAB layout (Int32Array):
//   [0] = state (0 waiting, 1 main has written data)
//   [1] = data byte length
// dataSab: Uint8Array of UTF-8 encoded user input

function blockingStdin(controlSab, dataSab) {
  const ctrl = new Int32Array(controlSab);
  const data = new Uint8Array(dataSab);
  return () => {
    // request input from main thread
    self.postMessage({ type: "stdin-request" });
    Atomics.store(ctrl, 0, 0);
    Atomics.wait(ctrl, 0, 0);
    const len = Atomics.load(ctrl, 1);
    const bytes = data.slice(0, len);
    const text = new TextDecoder().decode(bytes);
    return text;
  };
}

function emitChunk(kind, text) {
  // extract image markers
  const re = /\x1b__SANDBOX_IMG__([\s\S]*?)\x1b__END_IMG__\n?/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      self.postMessage({ type: kind, text: text.slice(last, m.index) });
    }
    self.postMessage({ type: "image", data: m[1] });
    last = re.lastIndex;
  }
  if (last < text.length) {
    self.postMessage({ type: kind, text: text.slice(last) });
  }
}

async function run(code, controlSab, dataSab) {
  const started = performance.now();
  pyodide.setStdout({ batched: (s) => emitChunk("stdout", s + "\n") });
  pyodide.setStderr({ batched: (s) => emitChunk("stderr", s + "\n") });
  pyodide.setStdin({ stdin: blockingStdin(controlSab, dataSab) });
  try {
    await pyodide.loadPackagesFromImports(code);
    // Auto-install mpl hook if the user imports matplotlib
    if (/\b(import\s+matplotlib|from\s+matplotlib)/.test(code)) {
      await pyodide.runPythonAsync(MPL_PATCH);
    }
    await pyodide.runPythonAsync(code);
    // Auto-show pending figures if user forgot plt.show()
    if (/\b(import\s+matplotlib|from\s+matplotlib)/.test(code)) {
      await pyodide.runPythonAsync("try:\n  import matplotlib.pyplot as plt; plt.show()\nexcept Exception:\n  pass");
    }
    self.postMessage({ type: "done", durationMs: Math.round(performance.now() - started) });
  } catch (e) {
    self.postMessage({ type: "error", message: e && e.message ? e.message : String(e), durationMs: Math.round(performance.now() - started) });
  }
}

async function install(packages) {
  try {
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    for (const name of packages) {
      await micropip.install(name);
      self.postMessage({ type: "stdout", text: `  ✓ ${name}\n` });
    }
    self.postMessage({ type: "install-done" });
  } catch (e) {
    self.postMessage({ type: "install-error", message: e && e.message ? e.message : String(e) });
  }
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === "init") return init();
  if (m.type === "run") return run(m.code, m.sab, m.dataSab);
  if (m.type === "install") return install(m.packages);
};
