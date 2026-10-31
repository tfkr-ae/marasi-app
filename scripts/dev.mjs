// `npm run dev`: starts the frontend's Vite dev server, then Electron on
// it. Arguments after `--` go to Electron, such as
// `npm run dev -- --remote-debugging-port=9222`. Quitting Electron stops
// the dev server.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// MARASI_DEV_PORT moves the dev server off 5173 (frontend/vite.config.js).
const devServerURL = `http://localhost:${Number(process.env.MARASI_DEV_PORT) || 5173}`;
const electron = createRequire(import.meta.url)("electron");

const frontend = join(root, "frontend");
const vite = spawn(process.execPath, [join(frontend, "node_modules", "vite", "bin", "vite.js"), "dev"], {
  cwd: frontend,
  stdio: "inherit",
});
vite.on("exit", (code) => process.exit(code ?? 1));

async function waitForDevServer() {
  for (;;) {
    try {
      await fetch(devServerURL);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

await waitForDevServer();
// Set when this runs under another Electron app's terminal; it would run
// Electron as plain Node.
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const app = spawn(electron, [root, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...env, MARASI_DEV_SERVER_URL: devServerURL },
});
app.on("exit", (code) => {
  vite.removeAllListeners("exit");
  vite.kill();
  process.exit(code ?? 0);
});
