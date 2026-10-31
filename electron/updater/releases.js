// Marasi App releases from the GitHub releases API at `base`
// (https://api.github.com/repos/<owner>/<repo>), through `fetch`, which
// tests replace with a fake GitHub. A port of v1's update_source.go.

/** The GitHub releases API of the Marasi App repository. */
export const defaultReleaseSource = "https://api.github.com/repos/tfkr-ae/marasi-app";

/** GitHub has no such release (none published yet, or one being republished). */
export class ReleaseNotFound extends Error {
  constructor() {
    super("release not found");
  }
}

/** The release's asset called name, or undefined. */
export const releaseAsset = (release, name) => release.assets.find((asset) => asset.name === name);

/** The release source at `base`; each call takes an AbortSignal. */
export function createReleaseSource({ base = defaultReleaseSource, fetch }) {
  async function get(path, signal) {
    let res;
    try {
      res = await fetch(base.replace(/\/$/, "") + path, {
        signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "marasi-app",
        },
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("GitHub did not answer in time");
      throw new Error(`could not reach GitHub: ${error?.cause?.message ?? error?.message ?? error}`);
    }
    if (res.status === 404) throw new ReleaseNotFound();
    if ((res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") || res.status === 429) {
      throw new Error("GitHub's rate limit for update checks is used up; try again in an hour");
    }
    if (res.status !== 200) throw new Error(`GitHub answered ${res.status} ${res.statusText ?? ""}`.trim());
    let body;
    try {
      body = await res.json();
    } catch (error) {
      throw new Error(`reading GitHub's answer: ${error.message}`);
    }
    return {
      tag: String(body.tag_name ?? ""),
      name: String(body.name ?? ""),
      notes: String(body.body ?? ""),
      page: String(body.html_url ?? ""),
      prerelease: Boolean(body.prerelease),
      assets: (Array.isArray(body.assets) ? body.assets : []).map((asset) => ({
        name: String(asset.name ?? ""),
        size: Number(asset.size) || 0,
        url: String(asset.browser_download_url ?? ""),
      })),
    };
  }
  return {
    /** The latest release that is not a prerelease. */
    latestRelease: (signal) => get("/releases/latest", signal),
    /** The release tagged `tag`, such as "v2-nightly". */
    releaseByTag: (tag, signal) => get(`/releases/tags/${encodeURIComponent(tag)}`, signal),
  };
}
