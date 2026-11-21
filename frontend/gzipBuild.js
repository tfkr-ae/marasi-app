// Replaces each file of the release build that compresses well with
// <name>.gz, so the app binary embeds only the compressed copy (main.go).
// newAssetHandler (assets.go) serves it under its original name: as gzip to a
// browser that accepts it in the server build, decompressed everywhere else.
// The `build` script runs it after `vite build`.
//
//   node gzipBuild.js [dir]   (default: build)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// Text-like types from Wails' extension table, which names the content type
// of a .gz by its original name. A file without an extension stays as it is:
// Wails sniffs its type from the bytes.
export const COMPRESSIBLE = /\.(html?|m?js|css|json|map|wasm|svg|txt|xml|md|ttf|otf|eot|woff|ico)$/i;
// Keep a .gz only when it saves at least this much (woff and woff2 are
// compressed already).
const MAX_RATIO = 0.9;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

/** Compresses dir in place; returns {compressed, before, after} in bytes. */
export function gzipBuild(dir) {
  let compressed = 0;
  let before = 0;
  let after = 0;
  for (const file of [...files(dir)]) {
    const data = fs.readFileSync(file);
    before += data.length;
    if (!COMPRESSIBLE.test(file) || fs.existsSync(`${file}.gz`)) {
      after += data.length;
      continue;
    }
    const gz = zlib.gzipSync(data, { level: 9 });
    if (gz.length > data.length * MAX_RATIO) {
      after += data.length;
      continue;
    }
    fs.writeFileSync(`${file}.gz`, gz);
    fs.rmSync(file);
    compressed += 1;
    after += gz.length;
  }
  return { compressed, before, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "build"));
  const { compressed, before, after } = gzipBuild(dir);
  const mib = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(`gzipped ${compressed} files: ${mib(before)} MiB → ${mib(after)} MiB`);
}
