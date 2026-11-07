// The connected service's own update (update.* events): the Marasi binary
// the service runs updating itself, apart from the app's updates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createServiceUpdateStore, SERVICE_UPDATE_EVENTS, serviceUpdateLine, serviceUpdateToast } from "./serviceUpdate.js";
import { createServiceClient } from "../lib/service/client.js";

const available = { instance: "default", version: "v1.4.0", channel: "release", published: "2026-11-01T00:00:00Z", notes: "Fixes", page: "https://example.com/v1.4.0" };

test("an available build shows, then the install's progress, then the result", () => {
  const store = createServiceUpdateStore();
  assert.equal(serviceUpdateLine(get(store)), null);

  store.onEvent("update.available", available);
  assert.equal(get(store).available.version, "v1.4.0");
  assert.equal(serviceUpdateLine(get(store)), "v1.4.0 available (release)");

  store.onEvent("update.progress", { instance: "default", version: "v1.4.0", step: "download", received: 512, total: 2048 });
  assert.equal(serviceUpdateLine(get(store)), "Installing v1.4.0: download 25%");

  store.onEvent("update.installed", { instance: "default", version: "v1.4.0", install_path: "/usr/local/bin/marasi" });
  assert.equal(serviceUpdateLine(get(store)), "v1.4.0 installed. Restart the service to run it.");
});

test("a failed install says where it stopped", () => {
  const store = createServiceUpdateStore();
  store.onEvent("update.failed", { instance: "default", version: "v1.4.0", kind: "verify", step: "verify", message: "checksum mismatch" });
  assert.equal(serviceUpdateLine(get(store)), "v1.4.0 not installed: checksum mismatch");
});

test("clear forgets the last service's update, on a connection switch", () => {
  const store = createServiceUpdateStore();
  store.onEvent("update.available", available);
  store.clear();
  assert.equal(serviceUpdateLine(get(store)), null);
});

test("available, installed and failed toast briefly; progress doesn't", () => {
  assert.deepEqual(serviceUpdateToast("update.available", available, "Local"), { message: "Marasi v1.4.0 available on Local", background: "variant-filled-primary" });
  assert.deepEqual(serviceUpdateToast("update.installed", { version: "v1.4.0" }, "Local"), { message: "Marasi v1.4.0 installed on Local", background: "variant-filled-success" });
  assert.deepEqual(serviceUpdateToast("update.failed", { version: "v1.4.0", message: "disk full" }, "Local"), { message: "Marasi update failed on Local: disk full", background: "variant-filled-error" });
  assert.equal(serviceUpdateToast("update.progress", {}, "Local"), null);
});

test("the update events reach the store over the service client's /events stream", () => {
  const sources = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sources.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    close() {}
    emit(type, data, id) {
      for (const listener of this.listeners.get(type) ?? []) listener({ type, data: JSON.stringify(data), lastEventId: id });
    }
  }
  const client = createServiceClient({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }), EventSource: FakeEventSource });
  client.use({ url: "http://127.0.0.1:9", password: "pw" });
  const store = createServiceUpdateStore();
  for (const name of SERVICE_UPDATE_EVENTS) client.on(name, (data) => store.onEvent(name, data));
  client.openEvents({});
  const [stream] = sources;
  stream.emit("update.available", available, "run.1");
  stream.emit("update.progress", { instance: "default", version: "v1.4.0", step: "verify", received: 2048, total: 2048 }, "run.2");
  assert.equal(serviceUpdateLine(get(store)), "Installing v1.4.0: verify 100%");
  stream.emit("update.failed", { instance: "default", version: "v1.4.0", kind: "network", step: "download", message: "connection reset" }, "run.3");
  assert.equal(serviceUpdateLine(get(store)), "v1.4.0 not installed: connection reset");
});
