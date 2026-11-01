// This machine's Chrome, which a remote connection's Start Chrome opens
// pointed at the remote instance's proxy listener. Its paths, profiles and
// each remote's proxy address are the GUI's own, in the app config's v2_*
// keys; v1's and Marasi's Chrome settings stay untouched. The launch mirrors
// Marasi's chrome/chrome.go: the same lookup and the same switches.

import { join } from "node:path";

const pathsKey = "v2_chrome_paths";
const profilesKey = "v2_chrome_profiles";
// {<remote origin>: "host:port"}: the proxy address each remote's Start
// Chrome uses instead of the default, such as an SSH tunnel's.
const proxyAddressesKey = "v2_chrome_proxy_addresses";

// The profile Start Chrome uses when none is chosen, as in Marasi.
export const defaultProfile = "default-profile";

const chromeOSes = new Set(["darwin", "linux", "windows"]);

// Where Chrome usually is, by OS, after the custom paths (chrome.go getChromePath).
const usualPaths = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/local/bin/chrome",
    "/usr/local/bin/chromium",
  ],
  windows: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium"],
};

// The features Marasi turns off because they send background requests
// through the proxy (chrome.go disabledFeatures).
const disabledFeatures = [
  "NetworkPrediction",
  "OmniboxUIExperimentMaxAutocompleteMatches",
  "AimEnabled",
  "OptimizationHints",
  "NetworkTimeServiceQuerying",
  "Translate",
  "MediaRouter",
  "DialMediaRouteProvider",
  "AutofillServerCommunication",
  "CertificateTransparencyComponentUpdater",
  "InterestFeedContentSuggestions",
];

// A CA's SPKI hash as GET /certificate answers it: base64 of a SHA-256.
const spkiHash = /^[A-Za-z0-9+/]{43}=$/;

// Go's runtime.GOOS for an Electron platform, as the paths name their OS.
const goos = (platform) => (platform === "win32" ? "windows" : platform);

// A refusal the renderer reads with errorCodes.js: "<what>: <code>: <cause>".
const refusal = (what, code, cause) => new Error(`${what}: ${code}: ${cause}`);

// The saved paths as [{os, path}], skipping entries that aren't.
function readPaths(saved) {
  return (Array.isArray(saved) ? saved : [])
    .filter((entry) => typeof entry?.os === "string" && typeof entry?.path === "string")
    .map(({ os, path }) => ({ os, path }));
}

// The saved profile names, skipping entries that aren't.
function readProfiles(saved) {
  return (Array.isArray(saved) ? saved : []).filter((name) => typeof name === "string");
}

// `name` trimmed, refused unless it names one directory in the profiles dir,
// as Marasi's validProfileName does. The default profile is always there.
function profileName(what, name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed) || trimmed === defaultProfile) {
    throw refusal(what, "invalid_request", `${JSON.stringify(trimmed)} can't name a profile`);
  }
  return trimmed;
}

// `address` as "host:port", refused unless it is one: a hostname or IP
// (an IPv6 one in brackets) and a port, nothing else.
export function proxyAddress(what, address) {
  const text = String(address ?? "").trim();
  const port = /:(\d{1,5})$/.exec(text)?.[1];
  let parsed = null;
  try {
    parsed = port && Number(port) > 0 && Number(port) < 65536 ? new URL(`http://${text}`) : null;
  } catch {}
  if (!parsed || parsed.host.toLowerCase() !== text.toLowerCase() || parsed.port !== port) {
    throw refusal(what, "invalid_request", `${JSON.stringify(text)} is not a host:port`);
  }
  return text;
}

const savedAddresses = (saved) => (saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {});

/**
 * The local Chrome. `appConfig` is createAppConfig's; `profilesDir` holds a
 * user-data-dir per profile; `isExecutable(path)` and `spawn(path, args)`
 * look up and start Chrome, and `removeDir(path)` deletes a profile's dir.
 */
export function createLocalChrome({ appConfig, profilesDir, platform = process.platform, isExecutable, spawn, removeDir }) {
  const os = goos(platform);
  const updatePaths = (change) => appConfig.updateV2Value(pathsKey, (saved) => change(readPaths(saved)));
  const updateProfiles = (change) => appConfig.updateV2Value(profilesKey, (saved) => change(readProfiles(saved)));

  // The first Chrome that runs: this OS's custom paths, then the usual places.
  async function chromePath(paths) {
    const candidates = [...paths.filter((entry) => entry.os === os).map((entry) => entry.path), ...(usualPaths[os] ?? [])];
    for (const path of candidates) {
      if (await isExecutable(path)) return path;
    }
    throw refusal("start chrome", "chrome_unavailable", `no Chrome found on ${os}`);
  }

  const local = {
    /** The custom Chrome paths: [{os, path}]. */
    async paths() {
      return readPaths(await appConfig.v2Value(pathsKey));
    },

    /** Adds a custom Chrome path for `os`; returns the paths. */
    addPath(path, os) {
      return updatePaths((paths) => {
        if (!String(path ?? "").trim() || !chromeOSes.has(os)) {
          throw refusal("add chrome path", "invalid_request", "a path needs a path and darwin, linux or windows");
        }
        if (paths.some((entry) => entry.os === os && entry.path === path)) {
          throw refusal("add chrome path", "path_already_exists", path);
        }
        return [...paths, { os, path }];
      });
    },

    /** Removes the custom Chrome path; returns the paths. */
    removePath(path, os) {
      return updatePaths((paths) => {
        if (!paths.some((entry) => entry.os === os && entry.path === path)) {
          throw refusal("delete chrome path", "not_found", path);
        }
        return paths.filter((entry) => !(entry.os === os && entry.path === path));
      });
    },

    /** The profile names, the default one left out. */
    async profiles() {
      return readProfiles(await appConfig.v2Value(profilesKey));
    },

    /** Adds the profile `name`; its user-data-dir is made when Chrome starts on it. */
    addProfile(name) {
      return updateProfiles((profiles) => {
        const profile = profileName("add chrome profile", name);
        if (profiles.includes(profile)) throw refusal("add chrome profile", "profile_already_exists", profile);
        return [...profiles, profile];
      });
    },

    /** Removes the profile `name` and its user-data-dir; returns the profiles. */
    async removeProfile(name) {
      const profile = profileName("delete chrome profile", name);
      const profiles = await updateProfiles((saved) => {
        if (!saved.includes(profile)) throw refusal("delete chrome profile", "not_found", profile);
        return saved.filter((entry) => entry !== profile);
      });
      await removeDir(join(profilesDir, profile));
      return profiles;
    },

    /** The proxy address saved for the remote at `origin`, "" for its default. */
    async proxyAddress(origin) {
      const saved = savedAddresses(await appConfig.v2Value(proxyAddressesKey))[origin];
      return typeof saved === "string" ? saved : "";
    },

    /** Saves the remote's proxy address, "" to go back to its default; returns it. */
    async setProxyAddress(origin, address) {
      const next = String(address ?? "").trim() ? proxyAddress("set chrome proxy address", address) : "";
      await appConfig.updateV2Value(proxyAddressesKey, (saved) => {
        const { [origin]: _, ...others } = savedAddresses(saved);
        return next ? { ...others, [origin]: next } : others;
      });
      return next;
    },

    /**
     * Opens Chrome on `profile` ("" for the default) through `proxy`
     * (host:port), trusting the CA whose SPKI hash is `spkiHash`, with
     * Marasi's switches (chrome.go Start).
     */
    async start({ profile, proxy, spkiHash: hash }) {
      const name = profile ? profileName("start chrome", profile) : defaultProfile;
      const address = proxyAddress("start chrome", proxy);
      if (!spkiHash.test(String(hash ?? ""))) throw refusal("start chrome", "invalid_request", "not a CA SPKI hash");
      if (name !== defaultProfile && !(await local.profiles()).includes(name)) {
        throw refusal("start chrome", "not_found", name);
      }
      const path = await chromePath(await local.paths());
      await spawn(path, [
        `--user-data-dir=${join(profilesDir, name)}`,
        `--proxy-server=http://${address}`,
        `--ignore-certificate-errors-spki-list=${hash}`,
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-component-extensions-with-background-pages",
        `--disable-features=${disabledFeatures.join(",")}`,
        "--disable-sync",
        "--metrics-recording-only",
        "--disable-domain-reliability",
        "--disable-breakpad",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-component-update",
        "--disable-search-engine-choice-screen",
        "--proxy-bypass-list=<-loopback>",
        `--window-name=Marasi - ${name}`,
        "about:blank",
      ]);
    },
  };
  return local;
}
