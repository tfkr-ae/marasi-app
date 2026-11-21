import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactRecords, createDocumentArtifacts, recordKey } from "./documentArtifacts.js";

// An artifact API over an in-memory list, as the Logbook's API would act.
function fakeArtifacts() {
  const artifacts = new Map();
  let next = 1;
  const calls = [];
  return {
    artifacts,
    calls,
    async upload(kind, recordId, file) {
      calls.push(["upload", kind, recordId, file.name]);
      const ID = `a${next++}`;
      artifacts.set(ID, { ID, kind, recordId, Filename: file.name });
      return { ID, Filename: file.name };
    },
    async remove(id) {
      calls.push(["remove", id]);
      if (!artifacts.delete(id)) throw Object.assign(new Error("not found"), { status: 404 });
    },
  };
}

const file = (name) => ({ name, type: "image/svg+xml" });
const doc = (attached = {}) => ({ id: "drawing-1", name: "Drawing 1", attached });

test("attaching records the Artifact the document made on that record", async () => {
  const api = fakeArtifacts();
  const artifacts = createDocumentArtifacts(api);
  const attached = await artifacts.attach(doc(), { kind: "finding", id: "f1" }, file("Drawing-1.excalidraw.svg"));
  assert.deepEqual(attached, {
    [recordKey("finding", "f1")]: { kind: "finding", recordId: "f1", artifactId: "a1", filename: "Drawing-1.excalidraw.svg" },
  });
  assert.deepEqual(artifacts.previous({ attached }, { kind: "finding", id: "f1" })?.artifactId, "a1");
  assert.equal(artifacts.previous({ attached }, { kind: "testCase", id: "f1" }), null);
});

test("attaching again replaces only this document's Artifact: delete, then upload", async () => {
  const api = fakeArtifacts();
  api.artifacts.set("by-hand", { ID: "by-hand", kind: "finding", recordId: "f1", Filename: "shot.png" });
  const artifacts = createDocumentArtifacts(api);
  const first = await artifacts.attach(doc(), { kind: "finding", id: "f1" }, file("d.svg"));
  const onCase = await artifacts.attach(doc(first), { kind: "testCase", id: "t1" }, file("d.svg"));
  api.calls.length = 0;
  const again = await artifacts.attach(doc(onCase), { kind: "finding", id: "f1" }, file("d.png"));
  assert.deepEqual(api.calls, [
    ["remove", "a1"],
    ["upload", "finding", "f1", "d.png"],
  ]);
  assert.deepEqual([...api.artifacts.keys()].sort(), ["a2", "a3", "by-hand"]);
  assert.equal(again[recordKey("finding", "f1")].artifactId, "a3");
  assert.equal(again[recordKey("testCase", "t1")].artifactId, "a2");
});

test("an Artifact already removed elsewhere doesn't stop the replacement", async () => {
  const api = fakeArtifacts();
  const artifacts = createDocumentArtifacts(api);
  const first = await artifacts.attach(doc(), { kind: "finding", id: "f1" }, file("d.svg"));
  api.artifacts.clear();
  const again = await artifacts.attach(doc(first), { kind: "finding", id: "f1" }, file("d.svg"));
  assert.equal(again[recordKey("finding", "f1")].artifactId, "a2");
});

test("detaching removes every Artifact the document made, and nothing else", async () => {
  const api = fakeArtifacts();
  api.artifacts.set("by-hand", { ID: "by-hand" });
  const artifacts = createDocumentArtifacts(api);
  let attached = await artifacts.attach(doc(), { kind: "finding", id: "f1" }, file("d.svg"));
  attached = await artifacts.attach(doc(attached), { kind: "testCase", id: "t1" }, file("d.svg"));
  api.artifacts.delete("a2");
  await artifacts.detachAll(doc(attached));
  assert.deepEqual([...api.artifacts.keys()], ["by-hand"]);
});

test("the records a document is attached to are named for the prompt", () => {
  const names = { "finding:f1": "SQL injection", "testCase:t1": "Login" };
  const attached = {
    "finding:f1": { kind: "finding", recordId: "f1", artifactId: "a1", filename: "d.svg" },
    "testCase:t1": { kind: "testCase", recordId: "t1", artifactId: "a2", filename: "d.svg" },
    "finding:gone": { kind: "finding", recordId: "gone", artifactId: "a3", filename: "d.svg" },
  };
  assert.deepEqual(
    artifactRecords({ attached }, (kind, id) => names[`${kind}:${id}`] ?? null),
    ["Finding “SQL injection”", "Test case “Login”", "Finding (deleted)"],
  );
});

test("an attach the connection moved past stops quietly, superseded", async () => {
  const api = fakeArtifacts();
  let live = true;
  const artifacts = createDocumentArtifacts({ ...api, bind: () => ({ live: () => live }) });
  const first = await artifacts.attach(doc(), { kind: "finding", id: "f1" }, file("d.svg"));
  const upload = api.upload;
  api.calls.length = 0;
  const moving = createDocumentArtifacts({
    bind: () => ({ live: () => live }),
    remove: async (id) => {
      await api.remove(id);
      live = false;
    },
    upload,
  });
  await assert.rejects(moving.attach(doc(first), { kind: "finding", id: "f1" }, file("d.svg")), { code: "superseded" });
  assert.deepEqual(api.calls, [["remove", "a1"]], "no upload went to the next connection");
});
