// Which Marasi Start runs: the bundled Marasi, or one the researcher chose
// from a path. The choice is this app's own, kept as JSON in `file` (in
// Electron's userData), so v1 never sees it. Tests pass a fake filesystem.
import { join } from "node:path";

/**
 * The bundled Marasi: in the packaged app's resources, or in this
 * checkout's resources/bin (scripts/build-marasi.sh builds it there).
 */
export function bundledMarasi({ isPackaged, resourcesPath, appPath, platform }) {
  const name = platform === "win32" ? "marasi.exe" : "marasi";
  return isPackaged ? join(resourcesPath, "bin", name) : join(appPath, "resources", "bin", name);
}

/**
 * Reads the researcher's choice from `file`. Resolves to `{bin, shown,
 * choose}`: bin() is the Marasi Start runs, shown() is `{path, bundled}`
 * for the renderer (path null for the bundled one), and choose(path)
 * keeps a new choice (null for the bundled one).
 */
export async function createMarasiChoice({ file, bundled, readFile, writeFile }) {
  let path = null;
  try {
    path = JSON.parse(await readFile(file, "utf8")).marasiPath || null;
  } catch {
    // No choice yet, or one we can't read: the bundled Marasi.
  }
  return {
    bin: () => path ?? bundled,
    shown: () => ({ path, bundled }),
    async choose(next) {
      await writeFile(file, JSON.stringify({ marasiPath: next || null }) + "\n");
      path = next || null;
    },
  };
}
