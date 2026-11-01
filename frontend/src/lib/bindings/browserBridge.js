// The preload bridge's stand-in in a plain browser on the dev server, the
// shape of `window.marasiApp` (electron/preload.mjs). The dev server answers
// for the main process (frontend/devBridge.js): it lists and connects to
// local instances and serves the app config. Start, remote instances, the
// OS dialogs (but a CA file, which a file input picks) and profile files
// need Marasi v2.

const outsideElectron = async () => {
  throw new Error("Open Marasi v2 to do this");
};

// The remote calls answer { error } rather than rejecting, as over IPC.
const remoteNeedsElectron = "Open Marasi v2 to connect to a remote instance";

async function call(method, path, body) {
  const response = await fetch(`/__marasi${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = await response.json().catch(() => null);
  if (!response.ok) throw new Error(answer?.message ?? `The dev server answered HTTP ${response.status}`);
  return answer;
}

// A CA file picked with the browser's file input, read as the main process
// reads one (electron/caFile.js): its text, or "" if cancelled.
const maxCAFileSize = 1 << 20;
function readCAFile() {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".pem,.crt,.cer" });
    input.addEventListener("cancel", () => resolve(""));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve("");
      if (file.size > maxCAFileSize) return reject(new Error(`${file.name} is too large for a CA certificate (over 1 MiB)`));
      file.text().then(resolve, reject);
    });
    input.click();
  });
}

export const browserBridge = {
  buildInfo: async () => ({ Channel: "dev", Version: "browser" }),
  listInstances: () => call("GET", "/instances"),
  startup: () => call("GET", "/connection"),
  connect: (instance) => call("POST", "/connect", { instance }),
  start: outsideElectron,
  disconnect: () => call("POST", "/disconnect"),
  connection: () => call("GET", "/connection"),
  listRemotes: async () => [],
  connectRemote: async () => ({ error: remoteNeedsElectron }),
  connectSaved: async () => ({ error: remoteNeedsElectron }),
  forgetRemote: async () => {},
  refusedRemote: async () => null,
  pickProject: outsideElectron,
  userName: async () => "Assessor",
  marasi: async () => null,
  // Outside Electron there is no bundled Marasi.
  runsBundled: async () => false,
  chooseMarasi: outsideElectron,
  saveCertificate: outsideElectron,
  saveArtifact: outsideElectron,
  saveReport: outsideElectron,
  readCAFile,
  copyText: (text) => navigator.clipboard.writeText(text),
  // A plain browser tab is the only window, so there is no other to list.
  newWindow: outsideElectron,
  openInstanceWindow: outsideElectron,
  windows: async () => [],
  focusWindow: async () => {},
  onWindowsChanged: () => () => {},
  reportProject: async () => {},
  reportHeld: async () => {},
  // Each app config call resolves { value } or { error }, as over IPC.
  appConfig: new Proxy(
    {},
    { get: (_, name) => (...args) => call("POST", `/app-config/${String(name)}`, args) },
  ),
};
