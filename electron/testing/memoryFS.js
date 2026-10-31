// An in-memory filesystem with the calls appConfig.js makes, for tests.
// `files` maps an absolute path to its text.

function notFound(path) {
  return Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: "ENOENT" });
}

export function memoryFS(initial = {}) {
  const files = new Map(Object.entries(initial));
  const modes = new Map();
  const fs = {
    files,
    modes,
    // Set to make the next write or rename fail, as a full disk would.
    failWrites: false,
    async readFile(path) {
      if (!files.has(path)) throw notFound(path);
      return files.get(path);
    },
    async writeFile(path, data, { mode } = {}) {
      if (fs.failWrites) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      files.set(path, String(data));
      if (mode !== undefined) modes.set(path, mode);
    },
    async rename(from, to) {
      if (!files.has(from)) throw notFound(from);
      files.set(to, files.get(from));
      files.delete(from);
      if (modes.has(from)) modes.set(to, modes.get(from));
      modes.delete(from);
    },
    async rm(path) {
      files.delete(path);
    },
    async mkdir() {},
  };
  return fs;
}
