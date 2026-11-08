// Stop and Start for a local connection that isn't the active one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createInstanceControl } from "./instanceControl.js";
import { removeBlock } from "./status.js";

// A fake instance behind Go's bindings, recording calls. Start makes the
// app own the run and Stop clears it, as StartLocalInstance and
// StopLocalInstance do.
function fakeInstance({ running = true, owned = true } = {}) {
  const calls = [];
  const instance = { running, owned };
  const api = {
    running: async () => instance.running,
    owns: async () => instance.owned,
    stop: async () => {
      calls.push("stop");
      instance.running = false;
      instance.owned = false;
    },
    start: async () => {
      calls.push("start");
      instance.running = true;
      instance.owned = true;
    },
  };
  return { api, calls, instance };
}

test("a running instance the app owns stops at once, and Remove turns on", async () => {
  const { api, calls } = fakeInstance({ running: true, owned: true });
  const control = createInstanceControl(api);
  await control.refresh();
  assert.equal(get(control).running, true);
  assert.equal(removeBlock({ isActive: false, ownedRun: get(control).owned }), "Stop it first");

  await control.stop();

  assert.deepEqual(calls, ["stop"]);
  assert.equal(get(control).running, false);
  assert.equal(get(control).busy, null);
  assert.equal(removeBlock({ isActive: false, ownedRun: get(control).owned }), null);
});

test("a run the app doesn't own asks first, and Cancel keeps it running", async () => {
  const { api, calls } = fakeInstance({ running: true, owned: false });
  const control = createInstanceControl(api);
  await control.refresh();

  await control.stop();
  assert.equal(get(control).stopAsk, true);
  assert.deepEqual(calls, []);

  control.cancelStop();
  assert.equal(get(control).stopAsk, false);
  assert.deepEqual(calls, []);

  await control.stop();
  await control.confirmStop();
  assert.deepEqual(calls, ["stop"]);
  assert.equal(get(control).stopAsk, false);
  assert.equal(get(control).running, false);
});

test("Start runs the instance with the app owning it, so Remove waits for a stop", async () => {
  const { api, calls } = fakeInstance({ running: false, owned: false });
  const control = createInstanceControl(api);
  await control.refresh();
  assert.equal(get(control).running, false);

  await control.start();

  assert.deepEqual(calls, ["start"]);
  assert.equal(get(control).running, true);
  assert.equal(get(control).owned, true);
  assert.equal(removeBlock({ isActive: false, ownedRun: get(control).owned }), "Stop it first");
});

test("a failed Start or Stop says why and reads the instance again", async () => {
  const { api } = fakeInstance({ running: false });
  api.start = async () => {
    throw new Error("starting the local instance: port 8080 in use");
  };
  const control = createInstanceControl(api);
  await control.refresh();

  await control.start();

  assert.match(get(control).error, /port 8080 in use/);
  assert.equal(get(control).busy, null);
  assert.equal(get(control).running, false);
});

test("an instance the app can't read offers neither Stop nor Start", async () => {
  const control = createInstanceControl({
    running: async () => {
      throw new Error("the Marasi CLI is missing");
    },
    owns: async () => {
      throw new Error("no");
    },
    stop: async () => {},
    start: async () => {},
  });
  await control.refresh();
  assert.equal(get(control).running, null);
  assert.equal(get(control).owned, false);
});

test("only the latest read lands", async () => {
  const answers = [];
  const control = createInstanceControl({
    running: () => new Promise((resolve) => answers.push(resolve)),
    owns: async () => false,
    stop: async () => {},
    start: async () => {},
  });
  const first = control.refresh();
  const second = control.refresh();
  await new Promise((r) => setTimeout(r, 0));
  answers[1](true);
  await second;
  answers[0](false);
  await first;

  assert.equal(get(control).running, true);
});
