import { extname, join, relative, isAbsolute } from "node:path";

/**
 * The file in the static frontend build at `root` that serves the URL path
 * `pathname`, or null when there is none. A page route, which has no file
 * extension, gets the build's fallback page, so the client router takes
 * over. `isFile(path)` says whether a file exists.
 */
export function assetPath(root, pathname, isFile) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = join(root, decoded);
  const inside = relative(root, path);
  if (inside.startsWith("..") || isAbsolute(inside)) return null;
  if (isFile(path)) return path;
  return extname(path) ? null : join(root, "index.html");
}
