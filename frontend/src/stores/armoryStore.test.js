import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createArmoryStore, drawerShareOf } from "./createArmoryStore.js";

// The drawer's share of the workspace, for a page whose workspace is 800 px
// tall and whose traffic section is `traffic` px (0 while it is measuring).
function share(store, { trafficOpen = true, traffic = 240 } = {}) {
  return drawerShareOf(get(store), { trafficOpen, trafficHeight: traffic, workspaceHeight: 800 });
}

test("until it is dragged, the drawer covers exactly the open traffic section", () => {
  const store = createArmoryStore({});
  assert.equal(share(store, { traffic: 240 }), 0.3);
  assert.equal(share(store, { traffic: 400 }), 0.5);
});

test("with the traffic section folded, the drawer opens at 38 % of the workspace", () => {
  const store = createArmoryStore({});
  assert.equal(share(store, { trafficOpen: false, traffic: 30 }), 0.38);
});

test("a drag sets the drawer's share, within 15 % to 85 %, whatever the traffic section", () => {
  const store = createArmoryStore({});
  store.setDrawerSplit(0.7);
  assert.equal(share(store, { traffic: 240 }), 0.7);
  assert.equal(share(store, { trafficOpen: false }), 0.7);
  store.setDrawerSplit(0.95);
  assert.equal(share(store), 0.85);
  store.setDrawerSplit(0.05);
  assert.equal(share(store), 0.15);
});

test("a new project puts the drawer back over the traffic section", () => {
  const store = createArmoryStore({});
  store.setDrawerSplit(0.7);
  store.clear();
  assert.equal(share(store, { traffic: 240 }), 0.3);
});
