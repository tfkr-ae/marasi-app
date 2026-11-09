import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionFor, listenerPort, projectName, unsavedInstances } from "./localInstances.js";

const listed = [
  { instance: "default", status: "running", proxy_listener: "127.0.0.1:8080" },
  { instance: "work", status: "running", proxy_listener: "127.0.0.1:9091" },
  { instance: "lab", status: "unhealthy", proxy_listener: "" },
];
const names = (list) => list.map((i) => i.instance);

test("the add form leaves out Local's instance and the ones saved connections name", () => {
  const connections = [
    { id: "local", kind: "local", instance: "default" },
    { id: "c1", kind: "local", instance: "lab" },
    { id: "r1", kind: "remote", instance: "work" },
  ];
  assert.deepEqual(names(unsavedInstances(listed, connections)), ["work"]);
});

test("a local connection without an instance names default", () => {
  assert.deepEqual(names(unsavedInstances(listed, [{ kind: "local" }])), ["work", "lab"]);
});

test("nothing listed offers nothing", () => {
  assert.deepEqual(unsavedInstances(null, []), []);
});

test("a listener's port, or 0 without one", () => {
  assert.equal(listenerPort("127.0.0.1:9091"), 9091);
  assert.equal(listenerPort("[::1]:8080"), 8080);
  assert.equal(listenerPort(""), 0);
  assert.equal(listenerPort(null), 0);
});

test("a project is its file name without .marasi", () => {
  assert.equal(projectName("/Users/a/projects/acme.marasi"), "acme");
  assert.equal(projectName("C:\\p\\scratchpad.marasi"), "scratchpad");
});

test("a listed instance adds named for itself on its proxy port", () => {
  assert.deepEqual(connectionFor(listed[1]), { name: "work", instance: "work", port: 9091 });
});
