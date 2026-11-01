// The Logbook's ported bindings: findings, test cases, their links and
// artifacts. Each sends its control API route and answers in the shape v1's
// frontend reads.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The connected instance answers each route from `answers`, by "METHOD path"
// (a function gets the request); a route with no answer is not_found.
beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const type = init.headers?.["Content-Type"];
    const body =
      init.body === undefined ? undefined : type === "application/json" ? JSON.parse(init.body) : init.body;
    const request = { method, path: parsed.pathname, search: parsed.search, type, body };
    sent.push(request);
    const answer = answers[`${method} ${parsed.pathname}`];
    if (answer === undefined) return json({ error: "not_found" }, 404);
    return typeof answer === "function" ? answer(request) : json(answer);
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

const pairs = (...ids) => ids.map((id) => ({ id, method: "GET", host: "example.com", path: `/${id}` }));

const findingDetail = {
  id: "f1",
  test_case_id: "t1",
  title: "IDOR on profile",
  severity: "High",
  cvss_vector: "CVSS:3.1/AV:N",
  cvss_score: 8.1,
  writeup: "steps",
  treatment_plan: "check owner",
  created_at: "2026-11-01T10:00:00Z",
  items: pairs("r1", "r2"),
  artifacts: [
    {
      id: "a1",
      filename: "shot.png",
      mime_type: "image/png",
      size: 4,
      finding_id: "f1",
      test_case_id: null,
      created_at: "2026-11-01T10:01:00Z",
    },
  ],
};

const findingRecord = {
  ID: "f1",
  TestCaseID: "t1",
  Title: "IDOR on profile",
  Requests: ["r1", "r2"],
  CVSSVector: "CVSS:3.1/AV:N",
  CVSSScore: 8.1,
  Severity: "High",
  WriteUp: "steps",
  TreatmentPlan: "check owner",
  Artifacts: [{ ID: "a1", Filename: "shot.png", MimeType: "image/png", Size: 4, CreatedAt: "2026-11-01T10:01:00Z" }],
  CreatedAt: "2026-11-01T10:00:00Z",
};

const testCaseDetail = {
  id: "t1",
  title: "Login test",
  description: "try it",
  category: "Authentication",
  tags: ["auth"],
  note: "n",
  created_at: "2026-11-01T09:00:00Z",
  items: pairs("r3"),
  artifacts: [],
};

const testCaseRecord = {
  ID: "t1",
  Title: "Login test",
  Description: "try it",
  Category: "Authentication",
  Tags: ["auth"],
  Requests: ["r3"],
  Artifacts: [],
  Note: "n",
  CreatedAt: "2026-11-01T09:00:00Z",
};

test("ListFindings reads each finding in full, as v1's Finding", async () => {
  answers["GET /finding"] = { items: [{ id: "f1", title: "IDOR on profile" }] };
  answers["GET /finding/f1"] = findingDetail;
  assert.deepEqual(await App.ListFindings(), [findingRecord]);
});

test("ListTestCases reads each test case in full, as v1's TestCase", async () => {
  answers["GET /test-case"] = { items: [{ id: "t1", title: "Login test" }] };
  answers["GET /test-case/t1"] = testCaseDetail;
  assert.deepEqual(await App.ListTestCases(), [testCaseRecord]);
});

test("a finding with no test case reads TestCaseID null", async () => {
  answers["GET /finding"] = { items: [{ id: "f1" }] };
  answers["GET /finding/f1"] = { ...findingDetail, test_case_id: null };
  assert.equal((await App.ListFindings())[0].TestCaseID, null);
});

test("SaveFinding writes every field of the finding, its test case among them", async () => {
  answers["POST /finding/f1"] = { id: "f1" };
  await App.SaveFinding({ ...findingRecord, Artifacts: undefined });
  assert.deepEqual(sent, [
    {
      method: "POST",
      path: "/finding/f1",
      search: "",
      type: "application/json",
      body: {
        title: "IDOR on profile",
        severity: "High",
        cvss_vector: "CVSS:3.1/AV:N",
        cvss_score: 8.1,
        writeup: "steps",
        treatment_plan: "check owner",
        test_case_id: "t1",
      },
    },
  ]);
});

test("SaveFinding without a test case clears it", async () => {
  answers["POST /finding/f1"] = { id: "f1" };
  await App.SaveFinding({ ...findingRecord, TestCaseID: undefined });
  assert.equal(sent[0].body.test_case_id, null);
});

test("SaveTestCase writes every field of the test case", async () => {
  answers["POST /test-case/t1"] = { id: "t1" };
  await App.SaveTestCase(testCaseRecord);
  assert.deepEqual(sent[0].body, {
    title: "Login test",
    description: "try it",
    category: "Authentication",
    tags: ["auth"],
    note: "n",
  });
});

test("DeleteFinding and DeleteTestCase delete the record", async () => {
  answers["DELETE /finding/f1"] = { id: "f1" };
  answers["DELETE /test-case/t1"] = { id: "t1" };
  await App.DeleteFinding("f1");
  await App.DeleteTestCase("t1");
  assert.deepEqual(
    sent.map((r) => `${r.method} ${r.path}`),
    ["DELETE /finding/f1", "DELETE /test-case/t1"],
  );
});

test("linking and unlinking a pair sends it to the record's traffic", async () => {
  for (const route of ["POST /finding/f1/traffic", "DELETE /finding/f1/traffic/r9", "POST /test-case/t1/traffic", "DELETE /test-case/t1/traffic/r9"])
    answers[route] = {};
  await App.LinkRequestToFinding("f1", "r9");
  await App.UnlinkRequestFromFinding("f1", "r9");
  await App.LinkRequestToTestCase("t1", "r9");
  await App.UnlinkRequestFromTestCase("t1", "r9");
  assert.deepEqual(
    sent.map((r) => [`${r.method} ${r.path}`, r.body]),
    [
      ["POST /finding/f1/traffic", { id: "r9" }],
      ["DELETE /finding/f1/traffic/r9", undefined],
      ["POST /test-case/t1/traffic", { id: "r9" }],
      ["DELETE /test-case/t1/traffic/r9", undefined],
    ],
  );
});

test("a link Marasi refuses rejects with its code", async () => {
  answers["POST /finding/f1/traffic"] = () => json({ error: "already_linked" }, 409);
  await assert.rejects(App.LinkRequestToFinding("f1", "r1"), { code: "already_linked" });
});

test("CreateDraftFinding creates v1's draft, links the pairs in one call, and reads it back", async () => {
  answers["POST /finding"] = { id: "f2" };
  answers["POST /traffic/bulk/link"] = { count: 2 };
  answers["GET /finding/f2"] = { ...findingDetail, id: "f2", title: "Draft Finding", items: pairs("r1", "r2") };
  const created = await App.CreateDraftFinding(["r1", "r2"], "t1");
  assert.deepEqual(
    sent.map((r) => [`${r.method} ${r.path}`, r.body]),
    [
      ["POST /finding", { title: "Draft Finding", severity: "High", writeup: "Writeup", test_case_id: "t1" }],
      ["POST /traffic/bulk/link", { selection: { ids: ["r1", "r2"] }, finding_id: "f2" }],
      ["GET /finding/f2", undefined],
    ],
  );
  assert.equal(created.ID, "f2");
  assert.deepEqual(created.Requests, ["r1", "r2"]);
});

test("CreateDraftTestCase creates v1's draft and links the pairs", async () => {
  answers["POST /test-case"] = { id: "t2" };
  answers["POST /traffic/bulk/link"] = { count: 1 };
  answers["GET /test-case/t2"] = { ...testCaseDetail, id: "t2", items: pairs("r1") };
  const created = await App.CreateDraftTestCase(["r1"]);
  assert.deepEqual(sent[0].body, { title: "Draft Test Case", description: "Test Case Description", category: "XSS", note: "Test Note" });
  assert.deepEqual(sent[1].body, { selection: { ids: ["r1"] }, test_case_id: "t2" });
  assert.deepEqual(created.Requests, ["r1"]);
});

test("a draft with no pairs makes no link call", async () => {
  answers["POST /finding"] = { id: "f2" };
  answers["GET /finding/f2"] = { ...findingDetail, id: "f2", test_case_id: null, items: [] };
  await App.CreateDraftFinding([], null);
  assert.deepEqual(sent.map((r) => `${r.method} ${r.path}`), ["POST /finding", "GET /finding/f2"]);
  assert.equal(sent[0].body.test_case_id, null);
});

test("a draft whose link fails still resolves, with only the pairs it has", async () => {
  answers["POST /finding"] = { id: "f2" };
  answers["POST /traffic/bulk/link"] = () => json({ error: "internal_server_error" }, 500);
  answers["GET /finding/f2"] = { ...findingDetail, id: "f2", items: [] };
  const created = await App.CreateDraftFinding(["r1", "gone"], null);
  assert.deepEqual(created.Requests, []);
});

const artifact = findingDetail.artifacts[0];

test("SaveArtifactToFinding uploads the file's bytes from this machine and answers v1's ArtifactMetadata", async () => {
  answers["POST /finding/f1/artifact"] = artifact;
  const saved = await App.SaveArtifactToFinding("f1", "shot one.png", "image/png", 4, [137, 80, 78, 71]);
  assert.equal(sent[0].search, "?filename=shot+one.png");
  assert.equal(sent[0].type, "image/png");
  assert.deepEqual(new Uint8Array(await new Response(sent[0].body).arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
  assert.deepEqual(saved, findingRecord.Artifacts[0]);
});

test("SaveArtifactToTestCase uploads to the test case, as octet-stream when the type is unknown", async () => {
  answers["POST /test-case/t1/artifact"] = { ...artifact, finding_id: null, test_case_id: "t1" };
  await App.SaveArtifactToTestCase("t1", "dump", "", 1, new Uint8Array([1]));
  assert.equal(sent[0].path, "/test-case/t1/artifact");
  assert.equal(sent[0].type, "application/octet-stream");
});

test("GetArtifact reads the artifact with its bytes", async () => {
  answers["GET /artifact/a1"] = artifact;
  answers["GET /artifact/a1/content"] = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  const read = await App.GetArtifact("a1");
  assert.equal(read.Filename, "shot.png");
  assert.equal(read.FindingID, "f1");
  assert.equal(read.TestCaseID, null);
  assert.deepEqual(read.Data, new Uint8Array([137, 80, 78, 71]));
});

test("DownloadArtifact saves the artifact's bytes on this machine under its name", async () => {
  const saved = [];
  globalThis.window = { marasiApp: { saveArtifact: async (name, bytes) => (saved.push([name, bytes]), "/Users/r/Downloads/shot.png") } };
  answers["GET /artifact/a1"] = artifact;
  answers["GET /artifact/a1/content"] = () => new Response(new Uint8Array([1, 2]));
  assert.equal(await App.DownloadArtifact("a1"), true);
  assert.deepEqual(saved, [["shot.png", new Uint8Array([1, 2])]]);
});

test("a cancelled download resolves false", async () => {
  globalThis.window = { marasiApp: { saveArtifact: async () => "" } };
  answers["GET /artifact/a1"] = artifact;
  answers["GET /artifact/a1/content"] = () => new Response(new Uint8Array([1]));
  assert.equal(await App.DownloadArtifact("a1"), false);
});

test("DeleteArtifact deletes it", async () => {
  answers["DELETE /artifact/a1"] = { id: "a1" };
  await App.DeleteArtifact("a1");
  assert.deepEqual(sent.map((r) => `${r.method} ${r.path}`), ["DELETE /artifact/a1"]);
});
