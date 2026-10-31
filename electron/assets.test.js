import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { assetPath } from "./assets.js";

const root = join("/app", "frontend", "build");
const files = new Set([join(root, "index.html"), join(root, "_app", "immutable", "start.js"), join(root, "favicon.png")]);
const isFile = (path) => files.has(path);

test("a file in the build is served as is", () => {
  assert.equal(assetPath(root, "/_app/immutable/start.js", isFile), join(root, "_app", "immutable", "start.js"));
  assert.equal(assetPath(root, "/favicon.png", isFile), join(root, "favicon.png"));
});

test("a page route gets the app's fallback page", () => {
  assert.equal(assetPath(root, "/", isFile), join(root, "index.html"));
  assert.equal(assetPath(root, "/ledger", isFile), join(root, "index.html"));
  assert.equal(assetPath(root, "/extension/workshop", isFile), join(root, "index.html"));
});

test("a missing asset is not found rather than the fallback page", () => {
  assert.equal(assetPath(root, "/_app/immutable/gone.js", isFile), null);
});

test("a path never reaches outside the build", () => {
  assert.equal(assetPath(root, "/../../secret.txt", (path) => path.endsWith("secret.txt")), null);
  assert.equal(assetPath(root, "/%2e%2e/%2e%2e/secret.txt", (path) => path.endsWith("secret.txt")), null);
});

test("an escaped name is decoded", () => {
  const spaced = join(root, "a file.png");
  assert.equal(assetPath(root, "/a%20file.png", (path) => path === spaced), spaced);
});
