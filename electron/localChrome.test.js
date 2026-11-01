import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { createAppConfig } from "./appConfig.js";
import { createLocalChrome } from "./localChrome.js";
import { memoryFS } from "./testing/memoryFS.js";

const configPath = "/cfg/marasi_appconfig.yaml";

// The local Chrome over an app config in memory, on `platform`, where
// `executables` are the paths that run. Each spawn is kept in `spawned`.
function setup({ text = "", platform = "darwin", executables = [] } = {}) {
  const fs = memoryFS(text ? { [configPath]: text } : {});
  const appConfig = createAppConfig({ dir: "/cfg", fs, platform });
  const spawned = [];
  const removed = [];
  const chrome = createLocalChrome({
    appConfig,
    profilesDir: "/cfg/v2_chrome_profiles",
    platform,
    isExecutable: async (path) => executables.includes(path),
    spawn: async (path, args) => spawned.push({ path, args }),
    removeDir: async (path) => removed.push(path),
  });
  const file = () => parse(fs.files.get(configPath) ?? "") ?? {};
  return { chrome, file, spawned, removed };
}

test("paths are kept in v2's own key, leaving v1's and Marasi's alone", async () => {
  const { chrome, file } = setup({ text: "chrome_dirs:\n  - os: darwin\n    path: /v1/chrome\n" });
  assert.deepEqual(await chrome.paths(), []);
  assert.deepEqual(await chrome.addPath("/opt/chromium", "darwin"), [{ os: "darwin", path: "/opt/chromium" }]);
  assert.deepEqual(await chrome.addPath("/usr/bin/chromium", "linux"), [
    { os: "darwin", path: "/opt/chromium" },
    { os: "linux", path: "/usr/bin/chromium" },
  ]);
  assert.deepEqual(await chrome.removePath("/opt/chromium", "darwin"), [{ os: "linux", path: "/usr/bin/chromium" }]);
  assert.deepEqual(file().v2_chrome_paths, [{ os: "linux", path: "/usr/bin/chromium" }]);
  assert.deepEqual(file().chrome_dirs, [{ os: "darwin", path: "/v1/chrome" }]);
});

test("profiles are kept in v2's own key, and removing one deletes its user-data-dir", async () => {
  const { chrome, file, removed } = setup({ text: "chrome_profiles:\n  - v1work\n" });
  assert.deepEqual(await chrome.addProfile(" work "), ["work"]);
  assert.deepEqual(await chrome.addProfile("lab"), ["work", "lab"]);
  await assert.rejects(chrome.addProfile("work"), /profile_already_exists/);
  for (const bad of ["", "../escape", "a/b", "default-profile"]) {
    await assert.rejects(chrome.addProfile(bad), /invalid_request/, JSON.stringify(bad));
  }
  assert.deepEqual(await chrome.removeProfile("work"), ["lab"]);
  assert.deepEqual(removed, ["/cfg/v2_chrome_profiles/work"]);
  await assert.rejects(chrome.removeProfile("work"), /not_found/);
  assert.deepEqual(await chrome.profiles(), ["lab"]);
  assert.deepEqual(file().v2_chrome_profiles, ["lab"]);
  assert.deepEqual(file().chrome_profiles, ["v1work"]);
});

test("each remote remembers its own proxy address, and clearing one goes back to the default", async () => {
  const { chrome, file } = setup();
  const a = "https://203.0.113.5:9443";
  const b = "http://198.51.100.7:7000";
  assert.equal(await chrome.proxyAddress(a), "");
  assert.equal(await chrome.setProxyAddress(a, " 127.0.0.1:18080 "), "127.0.0.1:18080");
  assert.equal(await chrome.setProxyAddress(b, "[::1]:9090"), "[::1]:9090");
  assert.equal(await chrome.proxyAddress(a), "127.0.0.1:18080");
  assert.equal(await chrome.proxyAddress(b), "[::1]:9090");
  assert.equal(await chrome.setProxyAddress(a, ""), "");
  assert.equal(await chrome.proxyAddress(a), "");
  assert.deepEqual(file().v2_chrome_proxy_addresses, { [b]: "[::1]:9090" });
});

test("a proxy address that isn't host:port is refused", async () => {
  const { chrome } = setup();
  for (const bad of ["127.0.0.1", "http://127.0.0.1:8080", "host:port", "a b:80", "127.0.0.1:8080/x", "127.0.0.1:70000"]) {
    await assert.rejects(chrome.setProxyAddress("http://r:1", bad), /invalid_request/, bad);
  }
});

const spki = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium";

test("start opens Chrome on the profile through the proxy, trusting the instance's CA, as Marasi starts it", async () => {
  const { chrome, spawned } = setup({ executables: [chromium] });
  await chrome.addProfile("work");
  await chrome.start({ profile: "work", proxy: "203.0.113.5:8080", spkiHash: spki });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].path, chromium);
  const { args } = spawned[0];
  assert.equal(args[0], "--user-data-dir=/cfg/v2_chrome_profiles/work");
  assert.ok(args.includes("--proxy-server=http://203.0.113.5:8080"));
  assert.ok(args.includes(`--ignore-certificate-errors-spki-list=${spki}`));
  assert.ok(args.includes("--proxy-bypass-list=<-loopback>"));
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.some((arg) => arg.startsWith("--disable-features=NetworkPrediction,")));
  assert.ok(args.includes("--window-name=Marasi - work"));
  assert.equal(args.at(-1), "about:blank");
});

test("start with no profile uses the default one", async () => {
  const { chrome, spawned } = setup({ executables: [chromium] });
  await chrome.start({ profile: "", proxy: "[::1]:8080", spkiHash: spki });
  assert.equal(spawned[0].args[0], "--user-data-dir=/cfg/v2_chrome_profiles/default-profile");
  assert.ok(spawned[0].args.includes("--proxy-server=http://[::1]:8080"));
});

test("a custom path for this OS is tried before the usual places, and others' are skipped", async () => {
  const { chrome, spawned } = setup({ executables: [chromium, "/opt/chrome", "/linux/chrome"] });
  await chrome.addPath("/linux/chrome", "linux");
  await chrome.addPath("/missing/chrome", "darwin");
  await chrome.addPath("/opt/chrome", "darwin");
  await chrome.start({ profile: "", proxy: "h:1", spkiHash: spki });
  assert.equal(spawned[0].path, "/opt/chrome");
});

test("start refuses an unknown profile, a bad CA hash or proxy, and a machine without Chrome", async () => {
  const { chrome, spawned } = setup({ executables: [chromium] });
  await assert.rejects(chrome.start({ profile: "nope", proxy: "h:1", spkiHash: spki }), /not_found/);
  await assert.rejects(chrome.start({ profile: "", proxy: "h:1", spkiHash: "x --flag" }), /invalid_request/);
  await assert.rejects(chrome.start({ profile: "", proxy: "h", spkiHash: spki }), /invalid_request/);
  assert.deepEqual(spawned, []);
  const bare = setup({ platform: "linux" });
  await assert.rejects(bare.chrome.start({ profile: "", proxy: "h:1", spkiHash: spki }), /chrome_unavailable/);
});
