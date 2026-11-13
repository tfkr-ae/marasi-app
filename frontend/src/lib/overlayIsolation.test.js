// Under an overlay the app goes inert, but for the mobile app's navigation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modalClosed, setAppInert } from "./overlayIsolation.js";

// A tiny element tree: el("name", ...children).
function el(name, ...children) {
  const node = { name, children, inert: false, dataset: {} };
  for (const child of children) child.parent = node;
  node.contains = (other) => {
    for (let at = other; at; at = at.parent) if (at === node) return true;
    return false;
  };
  node.querySelectorAll = (selector) => {
    const names = selector.split(",").map((s) => s.trim());
    const found = [];
    const walk = (at) => {
      for (const child of at.children) {
        const marked = selector === "[data-overlay-inert]" && "overlayInert" in child.dataset;
        if (marked || names.includes(child.name)) found.push(child);
        walk(child);
      }
    };
    walk(node);
    return found;
  };
  return node;
}

function app() {
  const rail = el(".nav-rail");
  const content = el("#content");
  const bar = el(".bottom-bar");
  const body = el(".app-body", rail, content, bar);
  const root = el(".app-frame", body);
  return { root, body, rail, content, bar };
}

test("with no live parts the whole app goes inert, and back", () => {
  const { root } = app();
  setAppInert(root, true, null);
  assert.equal(root.inert, true);
  setAppInert(root, false, null);
  assert.equal(root.inert, false);
});

test("the navigation and its ancestors stay live; the page goes inert", () => {
  const { root, body, rail, content, bar } = app();
  setAppInert(root, true, ".nav-rail, .bottom-bar");
  assert.equal(root.inert, false);
  assert.equal(body.inert, false);
  assert.equal(rail.inert, false);
  assert.equal(bar.inert, false);
  assert.equal(content.inert, true);
});

test("closing the overlay makes the page live again", () => {
  const { root, content } = app();
  setAppInert(root, true, ".nav-rail, .bottom-bar");
  setAppInert(root, false, ".nav-rail, .bottom-bar");
  assert.equal(content.inert, false);
  assert.equal(root.inert, false);
});

test("a modal waits for the one still closing", async () => {
  // Skeleton tears down a modal opened during the last one's close fade.
  let backdrop = true;
  const doc = { querySelector: (s) => (s === ".modal-backdrop" && backdrop ? {} : null) };
  let done = false;
  const waiting = modalClosed(doc, 1000).then(() => (done = true));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(done, false, "still waiting while the backdrop is there");
  backdrop = false;
  await waiting;
  assert.equal(done, true);
});

test("with no modal closing there is nothing to wait for, and a stuck one stops waiting", async () => {
  await modalClosed({ querySelector: () => null }, 1000);
  const started = Date.now();
  await modalClosed({ querySelector: () => ({}) }, 60);
  assert.ok(Date.now() - started < 500);
});
