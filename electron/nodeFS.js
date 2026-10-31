// node:fs/promises with the calls appConfig.js makes, where a write is
// flushed to disk before it resolves, so the rename that follows it is
// atomic even across a crash.
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";

export const nodeFS = {
  readFile,
  rename,
  rm,
  mkdir,
  async writeFile(path, data, { mode = 0o600 } = {}) {
    const handle = await open(path, "w", mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};
