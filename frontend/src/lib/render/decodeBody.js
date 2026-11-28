// Frontend HTTP Content-Encoding decoder with a 10 MiB decompression-bomb cap.
// Supports gzip, x-gzip, deflate (zlib-wrapped and raw), br (pure-JS Brotli),
// zstd (pure-JS fzstd), and chained codings applied in reverse order
// (matching marasi/db/traffic_index_decode.go).
import { decompress as brotliDecompress } from "brotli/decompress.js";
import { Decompress as ZstdDecompress } from "fzstd";

export const MAX_DECODED_BYTES = 10 * 1024 * 1024; // 10 MiB

class TooLargeError extends Error {
  constructor(limit) {
    super(`Decoded response exceeds the ${formatLimit(limit)} render limit`);
    this.code = "too-large";
  }
}

function formatLimit(bytes) {
  const mib = bytes / (1024 * 1024);
  return Number.isInteger(mib) ? `${mib} MiB` : `${mib.toFixed(1)} MiB`;
}

function concatChunks(chunks, totalLength) {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function decompressWithStream(bytes, format, maxBytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(`DecompressionStream(${format}) is not available`);
  }
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Feed input asynchronously; ignore write abort errors if reader cancels early on too-large.
  const writePromise = (async () => {
    try {
      await writer.write(bytes);
      await writer.close();
    } catch {
      // Aborted when reader cancels or encounters corrupt stream; reader surfaces the error.
    }
  })();

  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new TooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await writePromise;
  }

  return concatChunks(chunks, total);
}

function decompressBrotliBounded(bytes, maxBytes) {
  // Adaptive output buffer starting small (never allocating 10 MiB for tiny pages)
  // and growing up to maxBytes so decompression bombs abort cleanly at the cap.
  let outSize = Math.min(maxBytes, Math.max(bytes.length * 4, 64 * 1024));
  for (;;) {
    try {
      const decoded = brotliDecompress(bytes, outSize);
      if (decoded.length > maxBytes) throw new TooLargeError(maxBytes);
      return decoded;
    } catch (err) {
      if (err instanceof TooLargeError) throw err;
      const msg = String(err?.message ?? "");
      if (msg.includes("Output buffer is not large enough")) {
        if (outSize >= maxBytes) throw new TooLargeError(maxBytes);
        outSize = Math.min(maxBytes, outSize * 4);
        continue;
      }
      throw err;
    }
  }
}

function decompressZstdBounded(bytes, maxBytes) {
  const chunks = [];
  let total = 0;
  const dec = new ZstdDecompress((chunk) => {
    if (!chunk || chunk.length === 0) return;
    total += chunk.length;
    if (total > maxBytes) {
      throw new TooLargeError(maxBytes);
    }
    // Copy chunk in case fzstd reuses internal buffers across callbacks.
    chunks.push(chunk.slice());
  });

  // Push input in 64 KiB slices so large bombs fail early without buffering everything.
  const SLICE = 64 * 1024;
  for (let offset = 0; offset < bytes.length; offset += SLICE) {
    const end = Math.min(bytes.length, offset + SLICE);
    dec.push(bytes.subarray(offset, end), end >= bytes.length);
  }
  if (bytes.length === 0) {
    dec.push(bytes, true);
  }

  return concatChunks(chunks, total);
}

async function decodeOne(bytes, coding, maxBytes) {
  if (coding === "identity") return bytes;

  if (coding === "gzip" || coding === "x-gzip") {
    return decompressWithStream(bytes, "gzip", maxBytes);
  }

  if (coding === "deflate") {
    try {
      return await decompressWithStream(bytes, "deflate", maxBytes);
    } catch (err) {
      if (err instanceof TooLargeError) throw err;
      // Some servers send raw RFC 1951 deflate without the zlib wrapper.
      return decompressWithStream(bytes, "deflate-raw", maxBytes);
    }
  }

  if (coding === "br") {
    return decompressBrotliBounded(bytes, maxBytes);
  }

  if (coding === "zstd") {
    return decompressZstdBounded(bytes, maxBytes);
  }

  const unsupported = new Error(`Unsupported Content-Encoding: ${coding}`);
  unsupported.code = "unsupported-encoding";
  throw unsupported;
}

/**
 * Decodes `bodyBytes` through `contentEncodings` in reverse application order.
 * Always resolves to `{ ok: true, bytes }` or `{ ok: false, reason, coding, message }`.
 */
export async function decodeResponseBody(bodyBytes, contentEncodings = [], { maxBytes = MAX_DECODED_BYTES } = {}) {
  const input = bodyBytes instanceof Uint8Array ? bodyBytes : new Uint8Array(0);
  const codings = (contentEncodings ?? [])
    .map((c) => String(c ?? "").trim().toLowerCase())
    .filter((c) => c && c !== "identity");

  if (codings.length === 0 || input.length === 0) {
    return { ok: true, bytes: input };
  }

  let current = input;
  // Unwrap in reverse order of Content-Encoding application.
  for (let i = codings.length - 1; i >= 0; i--) {
    const coding = codings[i];
    try {
      current = await decodeOne(current, coding, maxBytes);
    } catch (err) {
      if (err?.code === "too-large") {
        return {
          ok: false,
          reason: "too-large",
          coding,
          message: err.message,
        };
      }
      if (err?.code === "unsupported-encoding") {
        return {
          ok: false,
          reason: "unsupported-encoding",
          coding,
          message: `Cannot decode Content-Encoding "${coding}"`,
        };
      }
      return {
        ok: false,
        reason: "corrupt",
        coding,
        message: `Failed to decode ${coding} response body`,
      };
    }
  }

  return { ok: true, bytes: current };
}
