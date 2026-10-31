import { test } from "node:test";
import assert from "node:assert/strict";
import { writable } from "svelte/store";
import { NotPorted } from "./notPorted.js";
import { toastNotPorted } from "./notPortedToast.js";

// A toast store like Skeleton's: a list of toasts, with trigger and close.
function fakeToastStore() {
  const { subscribe, update } = writable([]);
  return {
    subscribe,
    trigger: (toast) => update((toasts) => [...toasts, { ...toast, id: String(toasts.length) }]),
    close: (id) => update((toasts) => toasts.filter((toast) => toast.id !== id)),
  };
}

const toasts = (store) => {
  let list;
  store.subscribe((value) => (list = value))();
  return list;
};

test("an unhandled not ported call shows one short toast", () => {
  const store = fakeToastStore();
  assert.equal(toastNotPorted(store, new NotPorted("GetLogs")), true);
  assert.equal(toastNotPorted(store, new NotPorted("ListJobs")), true);
  assert.deepEqual(
    toasts(store).map((toast) => toast.message),
    ["Not ported yet"],
  );
});

test("the toast shows again once the last one has closed", () => {
  const store = fakeToastStore();
  toastNotPorted(store, new NotPorted("GetLogs"));
  store.close(toasts(store)[0].id);
  toastNotPorted(store, new NotPorted("GetLogs"));
  assert.equal(toasts(store).length, 1);
});

test("other rejections are left alone", () => {
  const store = fakeToastStore();
  assert.equal(toastNotPorted(store, new Error("disk full")), false);
  assert.deepEqual(toasts(store), []);
});
