// The Logbook over the service: createLogbookApi maps the control API's
// findings, test cases, artifacts, pairs and reports to the shapes
// createLogbookStore keeps, run here against a fake service client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLogbookApi } from "./logbookApi.js";
import { createLogbookStore } from "./createLogbookStore.js";

const b64 = (text) => Buffer.from(text).toString("base64");

// A fake service client answering from `routes` ("METHOD path" → body, or a
// function of {query, body, raw}), recording each call. A missing route is a
// 404, as the service gives for a record that's gone.
function fakeClient(routes) {
  const calls = [];
  const request = async (method, path, options = {}) => {
    calls.push({ method, path, ...options });
    const answer = routes[`${method} ${path}`];
    if (answer === undefined) throw new Error(`${method} ${path}: not_found: HTTP 404`);
    return typeof answer === "function" ? answer(options) : answer;
  };
  return {
    calls,
    request,
    get: (path, query) => request("GET", path, { query }),
    post: (path, body, query) => request("POST", path, { body, query }),
    put: (path, body, query) => request("PUT", path, { body, query }),
    del: (path, body, query) => request("DELETE", path, { body, query }),
  };
}

const findingBody = (id, extra = {}) => ({
  id,
  test_case_id: null,
  title: `Finding ${id}`,
  severity: "High",
  cvss_vector: "",
  cvss_score: 0,
  writeup: "",
  treatment_plan: "",
  created_at: "2026-11-06T10:00:00+04:00",
  ...extra,
});

const testCaseBody = (id, extra = {}) => ({
  id,
  title: `Test case ${id}`,
  description: "",
  category: "Auth",
  tags: ["login"],
  note: "",
  created_at: "2026-11-06T09:00:00+04:00",
  ...extra,
});

const artifactBody = (id, extra = {}) => ({
  id,
  filename: "shot.png",
  mime_type: "image/png",
  size: 3,
  test_case_id: null,
  finding_id: "f1",
  created_at: "2026-11-06T10:05:00+04:00",
  ...extra,
});

// GET /finding?full=1 and GET /test-case?full=1 list each record as its
// per-id read does; without full=1 they list summaries.
const fullList = (records) => ({ query } = {}) =>
  query?.full === 1 ? { items: records() } : { items: records().map(({ id, title }) => ({ id, title })) };

function projectRoutes() {
  const routes = {
    "GET /finding/f1": {
      ...findingBody("f1", { writeup: "XSS in search", test_case_id: "t1", cvss_vector: "CVSS:3.1/AV:N", cvss_score: 6.1 }),
      items: [{ id: "r1" }, { id: "r2" }],
      artifacts: [artifactBody("a1")],
    },
    "GET /finding/f2": { ...findingBody("f2"), items: [], artifacts: [] },
    "GET /test-case/t1": { ...testCaseBody("t1", { note: "Checked" }), items: [{ id: "r1" }], artifacts: [] },
  };
  const byPrefix = (prefix) => () =>
    Object.keys(routes)
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => routes[key]);
  routes["GET /finding"] = fullList(byPrefix("GET /finding/"));
  routes["GET /test-case"] = fullList(byPrefix("GET /test-case/"));
  return routes;
}

function setup({ routes = projectRoutes(), saved = "/Users/me/Downloads/file" } = {}) {
  const client = fakeClient(routes);
  const saves = [];
  const saveFile = async (...args) => {
    saves.push(args);
    return saved;
  };
  const store = createLogbookStore(createLogbookApi(client, { saveFile }));
  return { client, store, saves };
}

test("populate reads each finding and test case in full, in the store's shape", async () => {
  const { store } = setup();
  await store.populate();
  const { findings, testCases } = get(store);

  assert.deepEqual(findings.map((f) => f.ID), ["f1", "f2"]);
  const f1 = findings[0];
  assert.equal(f1.Title, "Finding f1");
  assert.equal(f1.WriteUp, "XSS in search");
  assert.equal(f1.TestCaseID, "t1");
  assert.equal(f1.CVSSVector, "CVSS:3.1/AV:N");
  assert.equal(f1.CVSSScore, 6.1);
  assert.deepEqual(f1.Requests, ["r1", "r2"]);
  assert.deepEqual(f1.Artifacts.map((a) => [a.ID, a.Filename, a.MimeType, a.Size]), [["a1", "shot.png", "image/png", 3]]);
  assert.equal(findings[1].TestCaseID, null);

  assert.deepEqual(testCases, [
    {
      ID: "t1",
      Title: "Test case t1",
      Description: "",
      Category: "Auth",
      Tags: ["login"],
      Note: "Checked",
      CreatedAt: "2026-11-06T09:00:00+04:00",
      Requests: ["r1"],
      Artifacts: [],
    },
  ]);
});

test("populate reads findings and test cases with one full list each", async () => {
  const { client, store } = setup();
  await store.populate();
  assert.deepEqual(
    client.calls.map((c) => [c.method, c.path, c.query]).sort(),
    [
      ["GET", "/finding", { full: 1 }],
      ["GET", "/test-case", { full: 1 }],
    ],
  );
});

test("saving a new finding drafts it, links its requests, writes its fields and uploads its files", async () => {
  const routes = Object.assign(projectRoutes(), {
    "POST /finding": ({ body }) => findingBody("f9", { title: body.title, test_case_id: body.test_case_id ?? null }),
    "POST /finding/f9/traffic": ({ body }) => ({ finding_id: "f9", id: body.id }),
    "POST /finding/f9": ({ body }) => findingBody("f9", body),
    "POST /finding/f9/artifact": ({ query }) => artifactBody("a9", { filename: query.filename, finding_id: "f9" }),
  });
  const { client, store } = setup({ routes });
  await store.populate();
  store.startNew("finding", { requestIds: ["r1"], testCaseId: "t1" });
  store.updateDraft({ Title: "Stored XSS", WriteUp: "Steps", CVSSVector: "CVSS:3.1/AV:N", CVSSScore: 6.1 });
  const file = { name: "proof.txt", type: "text/plain", size: 2 };
  store.addArtifacts([file]);

  const result = await store.save();

  assert.equal(result.ok, true);
  assert.equal(result.id, "f9");
  const writes = client.calls.filter((c) => c.method !== "GET");
  assert.deepEqual(
    writes.map((c) => `${c.method} ${c.path}`),
    ["POST /finding", "POST /finding/f9/traffic", "POST /finding/f9", "POST /finding/f9/artifact"],
  );
  assert.equal(writes[0].body.test_case_id, "t1");
  assert.deepEqual(writes[1].body, { id: "r1" });
  // The score is the service's to work out from the vector.
  assert.deepEqual(writes[2].body, {
    title: "Stored XSS",
    severity: "Medium",
    cvss_vector: "CVSS:3.1/AV:N",
    writeup: "Steps",
    treatment_plan: "",
    test_case_id: "t1",
  });
  assert.deepEqual(writes[3].query, { filename: "proof.txt" });
  assert.equal(writes[3].raw, file);
  assert.equal(writes[3].contentType, "text/plain");

  const saved = get(store).findings.find((f) => f.ID === "f9");
  assert.deepEqual(saved.Requests, ["r1"]);
  assert.deepEqual(saved.Artifacts.map((a) => a.ID), ["a9"]);
});

test("a new finding without a test case sends none", async () => {
  const routes = { ...projectRoutes(), "POST /finding": () => findingBody("f9"), "POST /finding/f9": () => findingBody("f9") };
  const { client, store } = setup({ routes });
  store.startNew("finding");
  store.updateDraft({ Title: "Open redirect" });
  await store.save();
  assert.equal("test_case_id" in client.calls.find((c) => c.path === "/finding").body, false);
  assert.equal(client.calls.find((c) => c.path === "/finding/f9").body.test_case_id, null);
});

test("saving a test case writes its fields, unlinks a request and deletes an artifact", async () => {
  const routes = Object.assign(projectRoutes(), {
    "GET /test-case/t1": { ...testCaseBody("t1"), items: [{ id: "r1" }], artifacts: [artifactBody("a3", { finding_id: null, test_case_id: "t1" })] },
    "POST /test-case/t1": ({ body }) => testCaseBody("t1", body),
    "DELETE /test-case/t1/traffic/r1": { test_case_id: "t1", id: "r1" },
    "DELETE /artifact/a3": { id: "a3" },
  });
  const { client, store } = setup({ routes });
  await store.populate();
  store.edit("testCase", "t1");
  store.updateDraft({ Note: "Done", Tags: ["login", "mfa"] });
  store.unlinkRequest("r1");
  store.removeArtifact("a3");

  assert.equal((await store.save()).ok, true);

  const writes = client.calls.filter((c) => c.method !== "GET");
  assert.deepEqual(
    writes.map((c) => `${c.method} ${c.path}`),
    ["POST /test-case/t1", "DELETE /test-case/t1/traffic/r1", "DELETE /artifact/a3"],
  );
  assert.deepEqual(writes[0].body, {
    title: "Test case t1",
    description: "",
    category: "Auth",
    tags: ["login", "mfa"],
    note: "Done",
  });
});

test("a new test case is drafted with its requests linked", async () => {
  const routes = {
    "POST /test-case": ({ body }) => testCaseBody("t9", body),
    "POST /test-case/t9/traffic": ({ body }) => ({ test_case_id: "t9", id: body.id }),
    "POST /test-case/t9": ({ body }) => testCaseBody("t9", body),
  };
  const { client, store } = setup({ routes });
  store.startNew("testCase", { requestIds: ["r1", "r2"] });
  store.updateDraft({ Title: "Login brute force" });
  assert.equal((await store.save()).ok, true);
  assert.deepEqual(
    client.calls.map((c) => `${c.method} ${c.path} ${c.body?.id ?? ""}`.trim()),
    ["POST /test-case", "POST /test-case/t9/traffic r1", "POST /test-case/t9/traffic r2", "POST /test-case/t9"],
  );
});

test("deleting a finding calls its route", async () => {
  const routes = { ...projectRoutes(), "DELETE /finding/f2": { id: "f2" } };
  const { store } = setup({ routes });
  await store.populate();
  assert.deepEqual(await store.deleteRecord("finding", "f2"), { ok: true });
  assert.deepEqual(get(store).findings.map((f) => f.ID), ["f1"]);
});

test("deleting a test case also clears it from the findings that named it", async () => {
  const routes = { ...projectRoutes(), "DELETE /test-case/t1": { id: "t1" } };
  const { store } = setup({ routes });
  await store.populate();
  assert.deepEqual(await store.deleteRecord("testCase", "t1"), { ok: true });
  assert.equal(get(store).findings.find((f) => f.ID === "f1").TestCaseID, null);
});

test("a linked pair reads in the full-pair shape, its raw text decoded", async () => {
  const routes = {
    "GET /traffic/r1": {
      id: "r1",
      number: 7,
      note: "",
      metadata: { a: 1 },
      highlight: null,
      request: { scheme: "https", method: "POST", host: "example.com", path: "/login", raw: b64("POST /login HTTP/1.1\r\n\r\nü"), requested_at: "t0" },
      response: { status: "200 OK", status_code: 200, content_type: "text/html", length: "5", raw: b64("HTTP/1.1 200 OK"), responded_at: "t1" },
      prettified: { request: null, response: "pretty" },
      upstream_proxy: null,
    },
  };
  const { store } = setup({ routes });
  const pair = await store.readPair("r1");
  assert.equal(pair.Request.Number, 7);
  assert.equal(pair.Request.Method, "POST");
  assert.equal(pair.Request.Host, "example.com");
  assert.equal(pair.Request.Path, "/login");
  assert.equal(pair.Request.Raw, "POST /login HTTP/1.1\r\n\r\nü");
  assert.equal(pair.Response.StatusCode, 200);
  assert.equal(pair.Response.Raw, "HTTP/1.1 200 OK");
  assert.deepEqual(pair.Prettified, { Request: "", Response: "pretty" });
});

test("an artifact reads with its bytes", async () => {
  const routes = {
    "GET /artifact/a1": artifactBody("a1"),
    "GET /artifact/a1/content": ({ as }) => (as === "bytes" ? new Uint8Array([1, 2, 3]) : null),
  };
  const { store } = setup({ routes });
  const artifact = await store.readArtifact("a1");
  assert.equal(artifact.Filename, "shot.png");
  assert.equal(artifact.MimeType, "image/png");
  assert.deepEqual([...artifact.Data], [1, 2, 3]);
});

test("downloading an artifact saves its bytes under its name through the native dialog", async () => {
  const routes = {
    "GET /artifact/a1": artifactBody("a1"),
    "GET /artifact/a1/content": () => new Uint8Array([104, 105]),
  };
  const { store, saves } = setup({ routes });
  assert.equal(await store.downloadArtifact("a1"), true);
  assert.deepEqual(saves, [["Save Artifact", "shot.png", "", "", b64("hi")]]);
});

test("a cancelled download saves nothing and says so", async () => {
  const routes = { "GET /artifact/a1": artifactBody("a1"), "GET /artifact/a1/content": () => new Uint8Array([1]) };
  const { store } = setup({ routes, saved: "" });
  assert.equal(await store.downloadArtifact("a1"), false);
});

test("report templates list by name, and the default restores", async () => {
  const routes = {
    "GET /report/template": { items: [{ name: "default_template.md", size: 10 }, { name: "client.html", size: 20 }] },
    "POST /report/template/restore": { items: [] },
  };
  const { client, store } = setup({ routes });
  assert.deepEqual(await store.listTemplates(), ["default_template.md", "client.html"]);
  await store.restoreDefaultTemplate();
  assert.ok(client.calls.some((c) => c.method === "POST" && c.path === "/report/template/restore"));
});

const metadata = {
  title: "Acme Report",
  client: "Acme",
  type: "Web",
  is_draft: false,
  scope: "acme.com",
  assessor: "Ada Lovelace",
  start: "2026-10-23",
  end: "2026-11-06",
  created_at: "2026-11-06T12:00:00.000Z",
  truncate_length: 0,
  custom_properties: { include_test_cases: false },
};

test("exporting renders the report on the service and saves it through the native dialog", async () => {
  const routes = { "POST /report": () => new Uint8Array([35, 32, 82]) };
  const { client, store, saves } = setup({ routes });

  assert.equal(await store.exportReport("default_template.md", metadata), true);

  const call = client.calls.find((c) => c.path === "/report");
  assert.equal(call.as, "bytes");
  assert.deepEqual(call.body, {
    template: "default_template.md",
    title: "Acme Report",
    client: "Acme",
    type: "Web",
    scope: "acme.com",
    assessor: "Ada Lovelace",
    start: "2026-10-23",
    end: "2026-11-06",
    is_draft: false,
    truncate_length: 0,
    include_test_cases: false,
    created_at: "2026-11-06T12:00:00.000Z",
    custom_properties: { include_test_cases: false },
  });
  assert.deepEqual(saves, [["Save Report", "Acme Report.md", "", "", b64("# R")]]);
});

test("an export names the file once with the template's extension, and a cancel says so", async () => {
  const routes = { "POST /report": () => new Uint8Array([1]) };
  const { store, saves } = setup({ routes, saved: "" });
  const saved = await store.exportReport("client.html", { ...metadata, title: "Acme.html", custom_properties: {} });
  assert.equal(saved, false);
  assert.equal(saves[0][1], "Acme.html");
});

test("a request linked or unlinked at once updates the record", async () => {
  const routes = Object.assign(projectRoutes(), {
    "POST /finding/f2/traffic": ({ body }) => ({ finding_id: "f2", id: body.id }),
    "DELETE /test-case/t1/traffic/r1": { test_case_id: "t1", id: "r1" },
  });
  const { store } = setup({ routes });
  await store.populate();
  await store.linkNow("finding", "f2", "r5");
  await store.unlinkNow("testCase", "t1", "r1");
  assert.deepEqual(get(store).findings.find((f) => f.ID === "f2").Requests, ["r5"]);
  assert.deepEqual(get(store).testCases[0].Requests, []);
});

test("reloading one record reads only it", async () => {
  const routes = projectRoutes();
  const { client, store } = setup({ routes });
  await store.populate();
  routes["GET /finding/f2"] = { ...findingBody("f2", { title: "Renamed" }), items: [{ id: "r3" }], artifacts: [] };
  client.calls.length = 0;

  await store.reload("finding", "f2");

  assert.deepEqual(client.calls.map((c) => c.path), ["/finding/f2"]);
  const f2 = get(store).findings.find((f) => f.ID === "f2");
  assert.equal(f2.Title, "Renamed");
  assert.deepEqual(f2.Requests, ["r3"]);
});

test("resync replaces the records and keeps the open edit session and fix", async () => {
  const routes = projectRoutes();
  const { store } = setup({ routes });
  await store.populate();
  store.open("finding", "f2");
  store.updateFix({ WriteUp: "half typed" });
  store.edit("finding", "f1");
  store.updateDraft({ Title: "Edited title" });
  routes["GET /finding/f3"] = { ...findingBody("f3"), items: [], artifacts: [] };

  await store.resync();

  const state = get(store);
  assert.deepEqual(state.findings.map((f) => f.ID), ["f1", "f2", "f3"]);
  assert.equal(state.session.draft.Title, "Edited title");
  assert.deepEqual(state.open, { kind: "finding", id: "f2", focus: null });
  assert.equal(state.fix.draft.WriteUp, "half typed");
});
