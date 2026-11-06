// The toasts a dropped and restored event stream show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnectionToasts } from "./connectionToasts.js";

// A toast store that keeps what is showing.
function fakeToasts() {
  const showing = new Map();
  let next = 0;
  return {
    showing,
    trigger(toast) {
      showing.set(++next, toast);
      return next;
    },
    close: (id) => showing.delete(id),
  };
}

const at = (phase) => ({ phase, connection: { name: "Local" } });

test("a drop shows a warning that stays until the stream is back", () => {
  const toasts = fakeToasts();
  const update = createConnectionToasts(toasts);
  update(at("connected"));
  update(at("reconnecting"));

  const [toast] = toasts.showing.values();
  assert.equal(toast.message, "Lost connection to Local. Reconnecting…");
  assert.equal(toast.background, "variant-filled-warning");
  assert.equal(toast.autohide, false);
  assert.equal(toasts.showing.size, 1);
});

test("further failed attempts show no more toasts", () => {
  const toasts = fakeToasts();
  const update = createConnectionToasts(toasts);
  update(at("connected"));
  update(at("reconnecting"));
  update({ ...at("reconnecting"), attempt: 2 });
  assert.equal(toasts.showing.size, 1);
});

for (const phase of ["connected", "project-changed"]) {
  test(`reconnecting (${phase}) swaps the warning for a short Reconnected toast`, () => {
    const toasts = fakeToasts();
    const update = createConnectionToasts(toasts);
    update(at("connected"));
    update(at("reconnecting"));
    update(at(phase));

    const shown = [...toasts.showing.values()];
    assert.equal(shown.length, 1);
    assert.equal(shown[0].message, "Reconnected to Local");
    assert.equal(shown[0].background, "variant-filled-success");
    assert.equal(shown[0].timeout, 3000);
  });
}

test("starting up shows no connection toasts", () => {
  const toasts = fakeToasts();
  const update = createConnectionToasts(toasts);
  for (const phase of ["idle", "starting", "connecting", "connected"]) update(at(phase));
  assert.equal(toasts.showing.size, 0);
});
