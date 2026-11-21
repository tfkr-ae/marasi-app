import { test } from "node:test";
import assert from "node:assert/strict";
import { chefAdapter } from "./chefAdapter.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// CyberChef's window as the adapter reaches it, with v11.6.0's bake
// bookkeeping cut down: bakeAll goes to the input worker and comes back as
// bakeInputs, which a running bake drops; the ChefWorker answers after
// `bakeMs`; setBakingStatus(false) ends every bake, through bakingComplete
// or cancelBake. app.setInput is silent; a statechange event counts a
// change and, debounced, runs Auto Bake when it is on.
function fakeChef({ bakeMs = 30, autoBake = false } = {}) {
  const log = [];
  const state = { input: "hello", outputs: {} };
  const statechange = { type: "statechange" };
  const app = {
    baking: false,
    autoBake_: autoBake,
    stateChangeId: 0,
    bakeStateId: 0,
    setInput: (text) => (state.input = text),
  };
  const win = {
    app,
    dispatchEvent(event) {
      if (event !== statechange) return;
      app.stateChangeId++;
      clearTimeout(state.debounce);
      state.debounce = setTimeout(() => {
        // CyberChef's autoBake: a running bake is stale now, so it goes,
        // with Auto Bake on or off.
        // With more than one output it cancels through cancelBake; with
        // one it stops the worker and sets app.baking itself.
        if (app.baking && state.oneOutput) {
          worker.chefWorkers[0].active = false;
          app.baking = false;
        } else if (app.baking) worker.cancelBake(true, false, true);
        if (app.autoBake_) worker.bakeInputs();
      }, 20);
    },
  };
  const worker = {
    chefWorkers: [{ active: false }],
    inputs: [],
    inputNums: [],
    loadingOutputs: 0,
    setBakingStatus(baking) {
      app.baking = baking;
      log.push(baking ? "baking" : "baked");
    },
    bakeInputs() {
      if (app.baking) return log.push("dropped");
      this.cancelBake(true, false, true); // clears out the last bake, as CyberChef does first
      this.setBakingStatus(true);
      app.bakeStateId = app.stateChangeId;
      if (state.outputs[1]) state.outputs[1].status = "pending";
      const input = state.input;
      this.chefWorkers[0].active = true;
      setTimeout(() => {
        if (!this.chefWorkers[0].active) return;
        this.chefWorkers[0].active = false;
        state.outputs[1] = { dish: Buffer.from(input).toString("base64"), status: "baked" };
        this.setBakingStatus(false);
      }, bakeMs);
    },
    cancelBake(silent, killAll, fromBakeInputs = false) {
      if (!fromBakeInputs) log.push("cancel");
      this.chefWorkers[0].active = false;
      this.loadingOutputs = 0;
      this.setBakingStatus(false);
    },
  };
  app.manager = {
    worker,
    statechange,
    tabs: { getActiveTab: () => 1 },
    input: {
      bakeAll: () => setTimeout(() => worker.bakeInputs(), 5),
      getInputNums: async () => [1],
      getInputValue: async () => state.input,
    },
    output: {
      outputs: state.outputs,
      getOutputDish: (n) => state.outputs[n]?.dish ?? null,
      getDishStr: async (dish) => dish,
    },
    controls: {
      // The Bake button: Cancel while a bake runs.
      bakeClick: () => (app.baking ? worker.cancelBake() : app.manager.input.bakeAll()),
    },
  };
  return { win, app, worker, state, log };
}

test("bake resolves to the output once CyberChef says the bake is complete, not before", async () => {
  const chef = fakeChef({ bakeMs: 80 });
  const adapter = chefAdapter(chef.win);
  assert.equal(await adapter.getOutput(), "");
  const output = await adapter.bake();
  assert.equal(output, "aGVsbG8=");
  assert.deepEqual(chef.log, ["baked", "baking", "baked"]);
});

test("bake lets a running bake finish instead of cancelling it, then bakes the current input", async () => {
  const chef = fakeChef({ bakeMs: 60 });
  const adapter = chefAdapter(chef.win);
  chef.worker.bakeInputs(); // an Auto Bake, already running
  chef.state.input = "world";
  assert.equal(await adapter.bake(), "d29ybGQ=");
  assert.ok(!chef.log.includes("cancel"), chef.log.join(", "));
});

test("bakes asked for together share one bake", async () => {
  const chef = fakeChef();
  const adapter = chefAdapter(chef.win);
  const [a, b] = await Promise.all([adapter.bake(), adapter.bake()]);
  assert.equal(a, "aGVsbG8=");
  assert.equal(b, "aGVsbG8=");
  assert.deepEqual(chef.log, ["baked", "baking", "baked"]);
});

test("getOutput waits for a running bake, so Attach never takes a half-baked output", async () => {
  const chef = fakeChef({ bakeMs: 60 });
  const adapter = chefAdapter(chef.win);
  chef.worker.bakeInputs();
  assert.equal(await adapter.getOutput(), "aGVsbG8=");
});

test("a bake CyberChef left stuck (its loading count below zero) is cancelled, and the bake still runs", async () => {
  const chef = fakeChef();
  const adapter = chefAdapter(chef.win);
  chef.worker.setBakingStatus(true);
  chef.worker.loadingOutputs = -2;
  assert.equal(await adapter.bake(5000), "aGVsbG8=");
  assert.deepEqual(chef.log.slice(1), ["cancel", "baked", "baked", "baking", "baked"]);
});

test("a bake with nothing in flight that never ends is cancelled after a quiet spell", async () => {
  const chef = fakeChef();
  const adapter = chefAdapter(chef.win);
  chef.worker.setBakingStatus(true);
  const start = Date.now();
  assert.equal(await adapter.bake(10000), "aGVsbG8=");
  assert.ok(Date.now() - start >= 1900, "cancelled before the quiet spell");
  assert.ok(chef.log.includes("cancel"));
});

test("a bake that is still working is not cancelled", async () => {
  const chef = fakeChef({ bakeMs: 2600 });
  const adapter = chefAdapter(chef.win);
  assert.equal(await adapter.bake(10000), "aGVsbG8=");
  assert.ok(!chef.log.includes("cancel"), chef.log.join(", "));
});

test("bake gives up with a message when CyberChef never finishes", async () => {
  const chef = fakeChef({ bakeMs: 1000 });
  const adapter = chefAdapter(chef.win);
  await assert.rejects(adapter.bake(300), /CyberChef didn't finish baking/);
  chef.worker.cancelBake();
  await wait(0);
});

test("an inserted input bakes when Auto Bake is on, as typing it would", async () => {
  const chef = fakeChef({ autoBake: true });
  const adapter = chefAdapter(chef.win);
  chef.state.input = "";
  await adapter.insertInput("world");
  await wait(150);
  assert.equal(await adapter.getOutput(), "d29ybGQ=");
});

test("currentOutput bakes when the output doesn't cover the input, and reads it as it is when it does", async () => {
  const chef = fakeChef();
  const adapter = chefAdapter(chef.win);
  assert.equal(await adapter.currentOutput(), "aGVsbG8=", "never baked");
  chef.state.input = "";
  await adapter.insertInput("world");
  assert.equal(await adapter.currentOutput(), "d29ybGQ=", "stale after an insert");
  const bakes = chef.log.filter((entry) => entry === "baking").length;
  assert.equal(await adapter.currentOutput(), "d29ybGQ=");
  assert.equal(chef.log.filter((entry) => entry === "baking").length, bakes, "baked again with nothing changed");
});

for (const oneOutput of [false, true]) test(`a bake that a recipe change cancels as it lands is baked again (${oneOutput ? "one output, no setBakingStatus" : "cancelBake"})`, async () => {
  const chef = fakeChef({ bakeMs: 80 });
  chef.state.oneOutput = oneOutput;
  const adapter = chefAdapter(chef.win);
  await adapter.bake();
  // The change is counted at once; CyberChef's handler runs 20 ms later,
  // after the bake below has started, and cancels it.
  chef.state.input = "world";
  chef.win.dispatchEvent(chef.app.manager.statechange);
  assert.equal(await adapter.bake(), "d29ybGQ=");
});
