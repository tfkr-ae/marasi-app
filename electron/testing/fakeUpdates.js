// Fakes for the updater tests, as v1's update_server_test.go: a GitHub that
// serves releases and their assets through `fetch`, signed with a throwaway
// key, and an app config holding the v2_* keys.
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner } from "./minisignSigner.js";

export const repo = "https://api.github.test/repos/tfkr-ae/marasi-app";
const page = (tag) => `https://github.test/tfkr-ae/marasi-app/releases/tag/${tag}`;

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export const tempDir = () => mkdtemp(join(tmpdir(), "mv2-update-"));

/**
 * A fake GitHub. publish(release) adds a release whose assets are
 * {name: contents}; a checksums.txt and its signature are added unless the
 * release says otherwise. requests lists every URL fetched.
 */
export function createFakeGitHub({ signer = createSigner() } = {}) {
  const releases = new Map();
  const assets = new Map();
  let latest = null;
  const github = {
    signer,
    publicKey: signer.publicKey,
    requests: [],
    // A body served by `hold(url)` waits until `release()`.
    held: new Map(),
    // Answers by URL that replace the asset, such as {status: 500}.
    answers: new Map(),

    publish({ tag, name = tag, notes = "", prerelease = false, files = {}, sign = true, signWith = signer, sums }) {
      const all = { ...files };
      if (sign) {
        const listed = sums ?? Object.fromEntries(Object.entries(files).map(([file, data]) => [file, sha256(data)]));
        const checksums = Object.entries(listed)
          .map(([file, sum]) => `${sum}  ${file}\n`)
          .join("");
        all["checksums.txt"] = checksums;
        all["checksums.txt.minisig"] = signWith.sign(Buffer.from(checksums));
      }
      const release = {
        tag_name: tag,
        name,
        body: notes,
        html_url: page(tag),
        prerelease,
        assets: Object.entries(all).map(([file, data]) => {
          const url = `https://github.test/download/${tag}/${file}`;
          assets.set(url, Buffer.from(data));
          return { name: file, size: Buffer.from(data).length, browser_download_url: url };
        }),
      };
      releases.set(tag, release);
      if (!prerelease) latest = tag;
      return release;
    },

    unpublish(tag) {
      releases.delete(tag);
      if (latest === tag) latest = null;
    },

    assetURL: (tag, file) => `https://github.test/download/${tag}/${file}`,

    /** Holds the body of url until the returned function is called. */
    hold(url) {
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      github.held.set(url, gate);
      return release;
    },

    async fetch(url, { signal } = {}) {
      github.requests.push(url);
      if (signal?.aborted) throw signal.reason;
      const answer = github.answers.get(url);
      if (answer?.error) throw new TypeError("fetch failed", { cause: new Error(answer.error) });
      if (answer?.status) return new Response("nope", { status: answer.status, headers: answer.headers });
      if (url.startsWith(repo)) {
        const path = url.slice(repo.length);
        const release = path === "/releases/latest" ? releases.get(latest) : releases.get(decodeURIComponent(path.replace("/releases/tags/", "")));
        if (!release) return new Response('{"message":"Not Found"}', { status: 404 });
        return Response.json(release);
      }
      const data = assets.get(url);
      if (!data) return new Response("Not Found", { status: 404 });
      const gate = github.held.get(url);
      if (!gate) return new Response(data, { headers: { "content-length": String(data.length) } });
      // Sends half, then waits for the gate or the abort.
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(data.subarray(0, data.length >> 1));
          signal?.addEventListener("abort", () => controller.error(signal.reason));
          gate.then(() => {
            if (signal?.aborted) return;
            controller.enqueue(data.subarray(data.length >> 1));
            controller.close();
          });
        },
      });
      return new Response(body, { headers: { "content-length": String(data.length) } });
    },
  };
  return github;
}

/** The app config's v2_* keys in memory; reads lists every key read. */
export function createFakeConfig(values = {}) {
  const stored = { ...values };
  return {
    values: stored,
    reads: [],
    failWrites: false,
    async get(key) {
      this.reads.push(key);
      return stored[key];
    },
    async set(key, value) {
      if (this.failWrites) throw new Error("disk full");
      stored[key] = value;
    },
  };
}

/** Timers that run only when the test says so. */
export function createFakeTimers() {
  const intervals = new Map();
  let next = 1;
  return {
    sleeps: [],
    setInterval(fn, ms) {
      const id = next++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    async sleep(ms) {
      this.sleeps.push(ms);
    },
    /** Runs every interval once, as when its time comes; resolves when they're done. */
    tick() {
      return Promise.all([...intervals.values()].map(({ fn }) => fn()));
    },
    get active() {
      return intervals.size;
    },
  };
}

/** A console that keeps what it was told. */
export function createLog() {
  const lines = [];
  return { lines, warn: (line) => lines.push(line), log: (line) => lines.push(line) };
}
