// The connection store sharing the local instance and changing passwords:
// Share and Stop sharing rebind the control listener, Change password
// rotates it on the instance, then the keychain, then reconnects the stream,
// and Turn off password asks for origins. Each change closes /events first
// and rejoins quietly, so the app never sees a drop or a refused password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore, initialConnection, reduce } from "./createConnectionStore.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const lab = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000", noPassword: false };
const named = { id: "remote-2", kind: "remote", name: "Box", url: "http://box.lan:9000", noPassword: false };
const status = { version: "dev", project: "/p/scratchpad.marasi", proxy_listener: "127.0.0.1:8080" };
const loopback = { status: "active", control_listener: "127.0.0.1:51391", password_set: true, allowed_origins: [] };
const APP = "wails://wails";

function run(...actions) {
  let state = initialConnection();
  const steps = [];
  const refusals = [];
  for (const action of actions) {
    const next = reduce(state, action);
    if (next.refusal) refusals.push(next.refusal);
    state = next.state;
    steps.push(...next.steps);
  }
  return { state, steps, types: steps.map((step) => step.type), refusals };
}

// Connected to the local instance with its control listener read.
const onLocal = [
  { type: "CONNECTIONS_LOADED", connections: [local, lab, named], activeId: "local" },
  { type: "APP_ORIGIN", origin: APP },
  { type: "APP_STARTED" },
  { type: "INSTANCE_UP", url: "http://127.0.0.1:51391", password: "pw", startedByApp: true },
  { type: "CONNECTED", status },
  { type: "CONTROL_LOADED", control: loopback },
];
const onRemote = (connection) => [
  { type: "CONNECTIONS_LOADED", connections: [local, lab, named], activeId: connection.id },
  { type: "APP_ORIGIN", origin: APP },
  { type: "APP_STARTED" },
  { type: "CONNECTED", id: connection.id, url: connection.url, status },
  { type: "CONTROL_LOADED", control: { ...loopback, control_listener: "0.0.0.0:9000" } },
];
const after = (prefix, ...actions) => {
  const before = run(...prefix);
  const next = run(...prefix, ...actions);
  return { ...next, steps: next.steps.slice(before.steps.length), types: next.types.slice(before.types.length) };
};

test("sharing rebinds the control listener on the interface and port picked", () => {
  const { state, steps, types } = after(onLocal, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000, host: "" });
  assert.equal(state.busy, "share");
  assert.equal(state.phase, "connected");
  assert.deepEqual(types, ["close-events", "update-control"]);
  assert.deepEqual(steps[1].body, { address: "100.64.1.2", port: 9000 });
});

test("sharing is only for the local instance, once connected, one change at a time", () => {
  assert.deepEqual(after(onRemote(lab), { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000 }).refusals, [
    "Only the local instance can be shared.",
  ]);
  assert.deepEqual(
    run(local, { type: "APP_STARTED" }, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000 }).refusals.at(-1),
    "Connect first.",
  );
  const twice = after(
    onLocal,
    { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000 },
    { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9001 },
  );
  assert.deepEqual(twice.refusals, ["Another change is under way."]);
});

test("sharing needs an IP to bind and a port from 0 to 65535", () => {
  assert.deepEqual(after(onLocal, { type: "SHARE_LOCAL", address: "", port: 9000 }).refusals, ["Pick an interface."]);
  assert.deepEqual(after(onLocal, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 70000 }).refusals, [
    "Enter a port from 0 to 65535.",
  ]);
});

test("without a password, sharing refuses a hostname in the code and sends the consent", () => {
  const noPassword = [...onLocal, { type: "CONTROL_LOADED", control: { ...loopback, password_set: false } }];
  assert.deepEqual(after(noPassword, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000, host: "mac.tail" }).refusals, [
    "Without a password, share by IP.",
  ]);
  const { steps } = after(noPassword, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000, host: "100.64.1.2" });
  assert.deepEqual(steps[1].body, { address: "100.64.1.2", port: 9000, no_password: true });
});

test("a shared listener reconnects the app there, quietly, and keeps the host in the code", () => {
  const shared = { ...loopback, control_listener: "100.64.1.2:9000" };
  const { state, types } = after(
    onLocal,
    { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000, host: "mac.tail" },
    { type: "CONTROL_UPDATED", control: shared },
    { type: "REJOINED", url: "http://100.64.1.2:9000", status, control: shared },
  );
  assert.deepEqual(types, ["close-events", "update-control", "rejoin", "open-events", "resync"]);
  assert.equal(state.phase, "connected");
  assert.equal(state.busy, null);
  assert.equal(state.url, "http://100.64.1.2:9000");
  assert.equal(state.shareHost, "mac.tail");
  assert.equal(state.control.address, "100.64.1.2:9000");
});

test("Stop sharing rebinds to loopback and forgets the host override", () => {
  const shared = { ...loopback, control_listener: "100.64.1.2:9000" };
  const { state, steps } = after(
    [...onLocal, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000, host: "mac.tail" }, { type: "CONTROL_UPDATED", control: shared }, { type: "REJOINED", url: "http://100.64.1.2:9000", status, control: shared }],
    { type: "STOP_SHARING" },
  );
  assert.deepEqual(steps[1].body, { address: "127.0.0.1", port: 0 });
  assert.equal(state.shareHost, "");
});

test("a refused change reopens the stream and says why", () => {
  const { state, types } = after(
    onLocal,
    { type: "SHARE_LOCAL", address: "100.64.1.2", port: 80 },
    { type: "CONTROL_FAILED", error: "listener_unavailable: address in use" },
  );
  assert.deepEqual(types, ["close-events", "update-control", "open-events", "resync"]);
  assert.equal(state.busy, null);
  assert.equal(state.changeError, "listener_unavailable: address in use");
});

test("a drop during a change waits for the change instead of reconnecting", () => {
  const { state, types } = after(onLocal, { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000 }, { type: "STREAM_DROPPED" });
  assert.equal(state.phase, "connected");
  assert.equal(types.includes("wait"), false);
});

test("Change password sets it on the instance, then the keychain, then reconnects the stream", () => {
  const { state, steps, types } = after(
    onRemote(lab),
    { type: "ROTATE_PASSWORD", password: "new-pw" },
    { type: "CONTROL_UPDATED", control: loopback, password: "new-pw" },
    { type: "KEYCHAIN_DONE", password: "new-pw" },
    { type: "REJOINED", url: lab.url, status, control: loopback },
  );
  assert.deepEqual(types, ["close-events", "update-control", "store-password", "rejoin", "open-events", "resync"]);
  assert.deepEqual(steps[1].body, { password: "new-pw" });
  assert.deepEqual(steps[2], { type: "store-password", id: "remote-1", password: "new-pw" });
  assert.deepEqual(steps[3], { type: "rejoin", password: "new-pw" });
  assert.equal(state.phase, "connected");
  assert.equal(JSON.stringify(state).includes("new-pw"), false);
});

test("the local instance's new password is read back from it, with no keychain step", () => {
  const { types } = after(onLocal, { type: "ROTATE_PASSWORD", password: "new-pw" }, { type: "CONTROL_UPDATED", control: loopback, password: "new-pw" });
  assert.deepEqual(types, ["close-events", "update-control", "rejoin"]);
});

test("a keychain that fails still reconnects with the new password, and says so", () => {
  const { state, steps } = after(
    onRemote(lab),
    { type: "ROTATE_PASSWORD", password: "new-pw" },
    { type: "CONTROL_UPDATED", control: loopback, password: "new-pw" },
    { type: "KEYCHAIN_DONE", password: "new-pw", error: "keychain locked" },
  );
  assert.deepEqual(steps.at(-1), { type: "rejoin", password: "new-pw" });
  assert.equal(state.changeError, "Saving the password failed: keychain locked");
});

test("Change password needs a password and a connection", () => {
  assert.deepEqual(after(onLocal, { type: "ROTATE_PASSWORD", password: "" }).refusals, ["Enter a password."]);
});

test("Turn off password needs at least one origin", () => {
  assert.deepEqual(after(onLocal, { type: "SET_NO_PASSWORD", origins: [] }).refusals, ["Add at least one origin."]);
  assert.deepEqual(after(onLocal, { type: "SET_NO_PASSWORD", origins: ["  "] }).refusals, ["Add at least one origin."]);
  assert.deepEqual(after(onLocal, { type: "SET_NO_PASSWORD", origins: ["http://x.test/path"] }).refusals, [
    "http://x.test/path isn't an origin such as http://localhost:5173.",
  ]);
});

test("Turn off password adds the app's own origin and removes the password", () => {
  const { steps } = after(onLocal, { type: "SET_NO_PASSWORD", origins: ["http://localhost:5173"] });
  assert.deepEqual(steps[1].body, { no_password: true, allowed_origins: ["http://localhost:5173", APP] });
  const once = after(onLocal, { type: "SET_NO_PASSWORD", origins: [APP.toUpperCase()] });
  assert.deepEqual(once.steps[1].body.allowed_origins, [APP]);
});

test("Turn off password is refused while sharing uses a hostname", () => {
  const shared = { ...loopback, control_listener: "100.64.1.2:9000" };
  const prefix = [
    ...onLocal,
    { type: "SHARE_LOCAL", address: "100.64.1.2", port: 9000, host: "mac.tail" },
    { type: "CONTROL_UPDATED", control: shared },
    { type: "REJOINED", url: "http://100.64.1.2:9000", status, control: shared },
  ];
  assert.deepEqual(after(prefix, { type: "SET_NO_PASSWORD", origins: ["http://localhost:5173"] }).refusals, [
    "Share by IP before turning the password off.",
  ]);
  const byIP = after(prefix, { type: "SET_SHARE_HOST", host: "100.64.1.2" }, { type: "SET_NO_PASSWORD", origins: ["http://localhost:5173"] });
  assert.deepEqual(byIP.refusals, []);
});

test("a remote reached by hostname can't turn its password off", () => {
  assert.deepEqual(after(onRemote(named), { type: "SET_NO_PASSWORD", origins: ["http://localhost:5173"] }).refusals, [
    "Reach it by IP before turning the password off.",
  ]);
});

test("without a password, the host in the code must be an IP", () => {
  const noPassword = [...onLocal, { type: "CONTROL_LOADED", control: { ...loopback, password_set: false } }];
  assert.deepEqual(after(noPassword, { type: "SET_SHARE_HOST", host: "mac.tail" }).refusals, ["Without a password, share by IP."]);
});

test("a remote's password turns off on the instance, then in the saved connection, then rejoins without one", () => {
  const { types, steps } = after(
    onRemote(lab),
    { type: "SET_NO_PASSWORD", origins: ["http://localhost:5173"] },
    { type: "CONTROL_UPDATED", control: { ...loopback, password_set: false, allowed_origins: ["http://localhost:5173", APP] } },
  );
  assert.deepEqual(types, ["close-events", "update-control", "forget-password"]);
  assert.deepEqual(steps[2], { type: "forget-password", id: "remote-1", origins: ["http://localhost:5173", APP] });
  const done = after(
    onRemote(lab),
    { type: "SET_NO_PASSWORD", origins: ["http://localhost:5173"] },
    { type: "CONTROL_UPDATED", control: { ...loopback, password_set: false } },
    { type: "KEYCHAIN_DONE", password: "" },
  );
  assert.deepEqual(done.steps.at(-1), { type: "rejoin", password: "" });
});

// The store performing a rotation through a fake api, in order.
function fakeApi() {
  const calls = [];
  let password = "pw";
  const api = {
    listConnections: async () => ({ connections: [local, lab], activeId: "remote-1" }),
    connectionPassword: async () => password,
    savePassword: async (id, next) => {
      calls.push(["savePassword", id, next]);
      password = next;
    },
    connectLocal: async () => ({ url: "http://127.0.0.1:51391", password: "pw", startedByApp: true }),
    use: (connection) => calls.push(["use", connection.password]),
    readStatus: async () => {
      calls.push("readStatus");
      return status;
    },
    readControl: async () => loopback,
    updateControl: async (body) => {
      calls.push(["updateControl", body]);
      return loopback;
    },
    openEvents: () => calls.push("openEvents"),
    closeEvents: () => calls.push("closeEvents"),
    loadProject: async () => {},
    resync: async () => calls.push("resync"),
    appOrigin: () => APP,
  };
  return { api, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("rotating a remote's password keeps the app connected, with no refusal seen", async () => {
  const { api, calls } = fakeApi();
  const store = createConnectionStore(api);
  const phases = [];
  store.subscribe((state) => phases.push(state.phase));
  await store.start();
  await settle();
  await settle();
  calls.length = 0;
  const seen = phases.length;
  assert.equal(store.changePassword("new-pw"), null);
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual(calls, [
    "closeEvents",
    ["updateControl", { password: "new-pw" }],
    ["savePassword", "remote-1", "new-pw"],
    ["use", "new-pw"],
    "readStatus",
    "openEvents",
    "resync",
  ]);
  assert.deepEqual([...new Set(phases.slice(seen))], ["connected"]);
  assert.equal(get(store).busy, null);
});
