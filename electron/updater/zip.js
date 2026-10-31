// Reading the zip a macOS build ships in, as v1's unzipApp did with Go's
// archive/zip: stored and deflated entries, with Unix modes and symlinks,
// and no zip64 (a Marasi build is far below its limits).
import { inflateRawSync } from "node:zlib";

const endOfCentralDirectory = 0x06054b50;
const centralHeader = 0x02014b50;
const localHeader = 0x04034b50;

/** A zip64 or otherwise unreadable archive. */
function bad(message) {
  return new Error(`not a zip Marasi can read: ${message}`);
}

/**
 * The entries of the zip in `data`: {name, mode, isDir, isSymlink, read()}
 * where mode is the Unix permission bits and read() returns the contents.
 */
export function zipEntries(data) {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (data.readUInt32LE(i) === endOfCentralDirectory) {
      end = i;
      break;
    }
  }
  if (end < 0) throw bad("no end of central directory");
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) throw bad("zip64");
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (data.readUInt32LE(offset) !== centralHeader) throw bad("broken central directory");
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const unixMode = data.readUInt32LE(offset + 38) >>> 16;
    const local = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    const type = unixMode & 0o170000;
    entries.push({
      name,
      mode: unixMode & 0o777,
      isDir: name.endsWith("/") || type === 0o040000,
      isSymlink: type === 0o120000,
      read() {
        if (data.readUInt32LE(local) !== localHeader) throw bad(`broken entry ${name}`);
        const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        const raw = data.subarray(start, start + compressedSize);
        if (method === 0) return raw;
        if (method === 8) {
          const out = inflateRawSync(raw);
          if (out.length !== size) throw bad(`${name} is not the size it says`);
          return out;
        }
        throw bad(`${name} uses compression method ${method}`);
      },
    });
  }
  return entries;
}
