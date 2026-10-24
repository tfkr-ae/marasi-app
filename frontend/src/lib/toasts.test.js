import { test } from "node:test";
import assert from "node:assert/strict";
import { handoffBackground, toastJump } from "./toasts.js";

test("handoff toasts are surface-coloured, with a border in light mode", () => {
  assert.equal(handoffBackground(true), "bg-surface-50 text-surface-900 border border-surface-300");
  assert.equal(handoffBackground(false), "bg-surface-100 text-surface-900");
});

test("a jump toast closes itself and leaves for its page", () => {
  const calls = [];
  const toastStore = {
    trigger: (toast) => {
      calls.push(["trigger", toast]);
      return "t1";
    },
    close: (id) => calls.push(["close", id]),
  };
  toastJump(toastStore, "Sent to a new launchpad", "Jump to Launchpad", true, () => calls.push(["go"]));
  const [, toast] = calls[0];
  assert.equal(toast.message, "Sent to a new launchpad");
  assert.equal(toast.background, "bg-surface-50 text-surface-900 border border-surface-300");
  assert.equal(toast.action.label, "Jump to Launchpad");
  toast.action.response();
  assert.deepEqual(calls.slice(1), [["close", "t1"], ["go"]]);
});
