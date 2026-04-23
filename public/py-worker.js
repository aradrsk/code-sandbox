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

async function run(code, controlSab, dataSab) {
  const started = performance.now();
  pyodide.setStdout({ batched: (s) => self.postMessage({ type: "stdout", text: s + "\n" }) });
  pyodide.setStderr({ batched: (s) => self.postMessage({ type: "stderr", text: s + "\n" }) });
  pyodide.setStdin({ stdin: blockingStdin(controlSab, dataSab) });
  try {
    await pyodide.loadPackagesFromImports(code);
    await pyodide.runPythonAsync(code);
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
