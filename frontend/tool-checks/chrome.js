// Headless Chrome over CDP for the tool contract checks, with Node's
// built-in WebSocket and no npm package. Every target (the page, its
// frames' workers, service workers) is attached before it runs, so every
// request it makes is seen. Name resolution is off for every host but
// loopback, so a request that would leave the machine also fails.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`no Chrome found; set CHROME_BIN (tried ${candidates.join(", ")})`);
  return found;
}

/** Launches Chrome and opens one page. Resolves to { page, requests, close }. */
export async function launchChrome({ width = 1600, height = 900 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "marasi-tool-checks-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  const child = spawn(chromeBinary(), args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));

  const portFile = path.join(profile, "DevToolsActivePort");
  let wsPath;
  for (let i = 0; i < 300 && !wsPath; i++) {
    if (child.exitCode !== null) throw new Error(`Chrome exited (${child.exitCode}): ${stderr}`);
    if (fs.existsSync(portFile)) {
      const [port, browserPath] = fs.readFileSync(portFile, "utf8").split("\n");
      if (browserPath) wsPath = `ws://127.0.0.1:${port}${browserPath}`;
    }
    if (!wsPath) await wait(100);
  }
  if (!wsPath) throw new Error(`Chrome didn't open DevTools: ${stderr}`);

  const socket = new WebSocket(wsPath);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("CDP connection failed"));
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id) {
      const call = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) call?.reject(new Error(`${call.method}: ${data.error.message}`));
      else call?.resolve(data.result);
      return;
    }
    for (const listener of listeners) listener(data);
  };

  // Every request any target makes: { url, type, status, failed }.
  const requests = [];
  const byId = new Map();
  const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
  // The session of each attached target, by target id.
  const sessions = new Map();
  listeners.push(async ({ method, params, sessionId }) => {
    if (method === "Target.attachedToTarget") {
      const child = params.sessionId;
      await send("Network.enable", {}, child).catch(() => {});
      await send("Page.enable", {}, child).catch(() => {});
      sessions.set(params.targetInfo.targetId, child);
      await send("Target.setAutoAttach", autoAttach, child).catch(() => {});
      await send("Runtime.runIfWaitingForDebugger", {}, child).catch(() => {});
    } else if (method === "Network.requestWillBeSent") {
      const entry = { url: params.request.url, type: params.type ?? "", status: 0, failed: "" };
      byId.set(`${sessionId}:${params.requestId}`, entry);
      requests.push(entry);
    } else if (method === "Network.responseReceived") {
      const entry = byId.get(`${sessionId}:${params.requestId}`);
      if (entry) entry.status = params.response.status;
    } else if (method === "Network.loadingFailed") {
      const entry = byId.get(`${sessionId}:${params.requestId}`);
      if (entry) entry.failed = params.errorText;
    }
  });
  await send("Target.setAutoAttach", autoAttach);

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  for (let i = 0; i < 100 && !sessions.has(targetId); i++) await wait(50);
  const sessionId = sessions.get(targetId);
  if (!sessionId) throw new Error("Chrome didn't attach the new page");
  await send("Runtime.enable", {}, sessionId);

  const call = (method, params) => send(method, params, sessionId);
  const page = {
    call,
    async goto(url) {
      await call("Page.navigate", { url });
    },
    /** Evaluates `expression` (an async function body's value) in the page. */
    async evaluate(expression, { timeoutMs = 60000 } = {}) {
      const result = await Promise.race([
        call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
        wait(timeoutMs).then(() => {
          throw new Error(`no answer in ${timeoutMs / 1000} s from ${expression.slice(0, 80)}`);
        }),
      ]);
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
        throw new Error(detail.split("\n")[0]);
      }
      return result.result.value;
    },
    /** Polls `expression` until it is truthy; resolves to its value (true for an element). */
    async waitFor(expression, { timeoutMs = 15000, message } = {}) {
      const start = Date.now();
      const probe = `(async () => { const value = await (${expression}); return value instanceof Node ? true : value; })()`;
      let last;
      while (Date.now() - start < timeoutMs) {
        try {
          last = await page.evaluate(probe);
          if (last) return last;
        } catch (err) {
          last = err.message;
        }
        await wait(100);
      }
      throw new Error(message ?? `timed out waiting for ${expression}${last ? ` (last: ${last})` : ""}`);
    },
    async mouse(type, x, y, extra = {}) {
      await call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
    },
    async click(x, y) {
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await page.mouse("mousePressed", x, y);
      await page.mouse("mouseReleased", x, y);
    },
    /** Presses `key` ({ key, code, keyCode }) with modifiers ["meta", "ctrl", "alt", "shift"]. */
    async press({ key, code, keyCode }, modifiers = []) {
      const bits = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
      const mask = modifiers.reduce((sum, name) => sum | bits[name], 0);
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: mask };
      await call("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
  };

  return {
    page,
    requests,
    async close() {
      try {
        await send("Browser.close");
      } catch {
        // already gone
      }
      socket.close();
      for (let i = 0; i < 50 && child.exitCode === null; i++) await wait(100);
      if (child.exitCode === null) child.kill("SIGKILL");
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}
