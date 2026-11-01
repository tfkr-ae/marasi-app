// The Armory's ported bindings: templates, runs and wordlists. Each sends
// its control API route and answers in the shape v1's frontend reads.
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
// (a function gets the request); any other route is Marasi's not_found.
beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const request = { method, path: parsed.pathname, search: parsed.search, body: init.body ? JSON.parse(init.body) : undefined };
    sent.push(request);
    const answer = answers[`${method} ${parsed.pathname}`];
    if (answer === undefined) return json({ error: "not_found" }, 404);
    return typeof answer === "function" ? answer(request) : json(answer);
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const T1 = "019a3b5c-0000-7000-8000-0000000000a1";
const T2 = "019a3b5c-0000-7000-8000-0000000000a2";
const R1 = "019a3b5c-0000-7000-8000-0000000000b1";
const R2 = "019a3b5c-0000-7000-8000-0000000000b2";
const R3 = "019a3b5c-0000-7000-8000-0000000000b3";

const run = (id, templateId, status) => ({
  id,
  template_id: templateId,
  template_snapshot: "GET /{{index .Payloads 0}} HTTP/1.1\r\nHost: example.com\r\n\r\n",
  use_https: true,
  wordlists: ["paths.txt"],
  status,
  attack_type: "harpoon",
  max_concurrent: 10,
  created_at: "2026-11-01T10:00:00+04:00",
  started_at: status === "draft" ? null : "2026-11-01T10:00:01+04:00",
  finished_at: status === "complete" || status === "cancelled" ? "2026-11-01T10:00:09+04:00" : null,
});

test("GetArmoryTemplates lists every template with its raw template, as v1's ArmoryTemplate", async () => {
  answers["GET /armory/template"] = {
    items: [
      { id: T1, name: "Login", description: "POST /login" },
      { id: T2, name: "Paths", description: "" },
    ],
  };
  answers[`GET /armory/template/${T1}`] = { id: T1, name: "Login", description: "POST /login", raw_template: "POST /login" };
  answers[`GET /armory/template/${T2}`] = { id: T2, name: "Paths", description: "", raw_template: "GET /{{x}}" };
  assert.deepEqual(await App.GetArmoryTemplates(), [
    { ID: T1, Name: "Login", Description: "POST /login", RawTemplate: "POST /login" },
    { ID: T2, Name: "Paths", Description: "", RawTemplate: "GET /{{x}}" },
  ]);
});

test("CreateArmoryTemplate posts the template and answers it as v1's ArmoryTemplate", async () => {
  answers["POST /armory/template"] = ({ body }) => json({ id: T1, ...body });
  const template = await App.CreateArmoryTemplate("Login", "POST /login", "POST /login HTTP/1.1");
  assert.deepEqual(sent.at(-1).body, { name: "Login", description: "POST /login", raw_template: "POST /login HTTP/1.1" });
  assert.deepEqual(template, { ID: T1, Name: "Login", Description: "POST /login", RawTemplate: "POST /login HTTP/1.1" });
});

test("CreateArmoryTemplateFromRequest names the template after the pair and holds its raw request, as v1", async () => {
  const P = "019a3b5c-0001-7000-8000-000000000007";
  answers[`GET /traffic/${P}`] = {
    id: P,
    number: 7,
    request: {
      scheme: "https",
      method: "POST",
      host: "example.com",
      path: "/login?next=/",
      raw: btoa("POST /login?next=/ HTTP/1.1\r\nHost: example.com\r\n\r\nuser=a"),
    },
  };
  answers["POST /armory/template"] = ({ body }) => json({ id: T1, ...body });
  const template = await App.CreateArmoryTemplateFromRequest(P);
  assert.deepEqual(sent.at(-1).body, {
    name: "POST example.com/login?next=/",
    description: "Imported from request history",
    raw_template: "POST /login?next=/ HTTP/1.1\r\nHost: example.com\r\n\r\nuser=a",
  });
  assert.equal(template.ID, T1);
});

test("UpdateArmoryTemplate posts every field to the template, and DeleteArmoryTemplate deletes it", async () => {
  answers[`POST /armory/template/${T1}`] = ({ body }) => json({ id: T1, ...body });
  answers[`DELETE /armory/template/${T1}`] = { id: T1 };
  await App.UpdateArmoryTemplate(T1, "Login", "", "POST /login");
  assert.deepEqual(sent.at(-1), {
    method: "POST",
    path: `/armory/template/${T1}`,
    search: "",
    body: { name: "Login", description: "", raw_template: "POST /login" },
  });
  await App.DeleteArmoryTemplate(T1);
  assert.equal(`${sent.at(-1).method} ${sent.at(-1).path}`, `DELETE /armory/template/${T1}`);
});

test("a template with an active run refuses to delete with Marasi's code", async () => {
  answers[`DELETE /armory/template/${T1}`] = () => json({ error: "template_has_active_run" }, 409);
  await assert.rejects(App.DeleteArmoryTemplate(T1), /template_has_active_run/);
});

test("GetArmoryRuns lists a template's runs and GetArmoryRun reads one, as v1's ArmoryRun", async () => {
  answers[`GET /armory/template/${T1}/run`] = { items: [run(R1, T1, "draft")] };
  answers[`GET /armory/run/${R2}`] = run(R2, T1, "complete");
  assert.deepEqual(await App.GetArmoryRuns(T1), [
    {
      ID: R1,
      TemplateID: T1,
      TemplateSnapshot: "GET /{{index .Payloads 0}} HTTP/1.1\r\nHost: example.com\r\n\r\n",
      UseHTTPS: true,
      Wordlists: ["paths.txt"],
      Status: "draft",
      AttackType: "harpoon",
      MaxConcurrent: 10,
      CreatedAt: "2026-11-01T10:00:00+04:00",
      StartedAt: null,
      FinishedAt: null,
    },
  ]);
  const done = await App.GetArmoryRun(R2);
  assert.equal(done.Status, "complete");
  assert.equal(done.FinishedAt, "2026-11-01T10:00:09+04:00");
});

test("GetActiveArmoryRunIDs walks every template's runs for the ones in progress", async () => {
  answers["GET /armory/template"] = { items: [{ id: T1, name: "a", description: "" }, { id: T2, name: "b", description: "" }] };
  answers[`GET /armory/template/${T1}/run`] = { items: [run(R1, T1, "in_progress"), run(R2, T1, "cancelled")] };
  answers[`GET /armory/template/${T2}/run`] = { items: [run(R3, T2, "in_progress")] };
  assert.deepEqual(await App.GetActiveArmoryRunIDs(), [R1, R3]);
});

test("ValidateArmoryRun posts the unsaved run, and answers nothing when Marasi accepts it", async () => {
  answers["POST /armory/run/validate"] = { status: "ok" };
  assert.equal(await App.ValidateArmoryRun("GET / HTTP/1.1", "harpoon", ["paths.txt"], 5), undefined);
  assert.deepEqual(sent.at(-1).body, {
    raw_template: "GET / HTTP/1.1",
    attack_type: "harpoon",
    wordlists: ["paths.txt"],
    max_concurrent: 5,
  });
});

test("ValidateArmoryRun rejects with Marasi's code for a run it refuses", async () => {
  answers["POST /armory/run/validate"] = () => json({ error: "invalid_armory_request" }, 400);
  await assert.rejects(App.ValidateArmoryRun("GET / HTTP/1.1", "harpoon", [], 5), /invalid_armory_request/);
});

test("CreateArmoryRun posts a draft of the template and answers it as v1's ArmoryRun", async () => {
  answers["POST /armory/run"] = run(R1, T1, "draft");
  const created = await App.CreateArmoryRun(T1, "harpoon", false, ["paths.txt"], 3);
  assert.deepEqual(sent.at(-1).body, {
    template_id: T1,
    attack_type: "harpoon",
    use_https: false,
    wordlists: ["paths.txt"],
    max_concurrent: 3,
  });
  assert.equal(created.ID, R1);
  assert.equal(created.Status, "draft");
});

test("StartArmoryRun, CancelArmoryRun and DeleteArmoryRun send the run's routes", async () => {
  answers[`POST /armory/run/${R1}/start`] = run(R1, T1, "in_progress");
  answers[`POST /armory/run/${R1}/cancel`] = run(R1, T1, "cancelled");
  answers[`DELETE /armory/run/${R1}`] = { id: R1 };
  await App.StartArmoryRun(R1);
  await App.CancelArmoryRun(R1);
  await App.DeleteArmoryRun(R1);
  assert.deepEqual(
    sent.map((request) => `${request.method} ${request.path}`),
    [`POST /armory/run/${R1}/start`, `POST /armory/run/${R1}/cancel`, `DELETE /armory/run/${R1}`],
  );
});

test("GetArmoryWordlists lists the instance machine's wordlists as v1's wordlist Info", async () => {
  answers["GET /wordlist"] = { items: [{ name: "paths.txt", size: 1024 }, { name: "users.txt", size: 12 }] };
  assert.deepEqual(await App.GetArmoryWordlists(), [
    { Name: "paths.txt", Size: 1024 },
    { Name: "users.txt", Size: 12 },
  ]);
});

test("PreviewArmoryWordlist reads a wordlist's first entries", async () => {
  answers["GET /wordlist/my%20list.txt"] = { name: "my list.txt", items: ["admin", "login"] };
  assert.deepEqual(await App.PreviewArmoryWordlist("my list.txt", 20), ["admin", "login"]);
  assert.equal(sent.at(-1).search, "?limit=20");
});

const P1 = "019a3b5c-0001-7000-8000-000000000001";
const P2 = "019a3b5c-0001-7000-8000-000000000002";

const summary = (id, number, statusCode, length) => ({
  id,
  number,
  scheme: "https",
  method: "GET",
  host: "example.com",
  path: `/${number}`,
  status: `${statusCode} OK`,
  status_code: statusCode,
  content_type: "text/html",
  length,
  metadata: { armory_run_id: R1 },
  requested_at: "2026-11-01T10:00:02+04:00",
  responded_at: "2026-11-01T10:00:03+04:00",
});

test("QueryArmoryRunTraffic reads a page of the run's pairs, narrowed by the request's query and whatever their content type", async () => {
  answers["GET /traffic"] = { items: [summary(P2, 2, 404, 9), summary(P1, 1, 200, 12)], next_cursor: P1, as_of: P2 };
  const page = await App.QueryArmoryRunTraffic(R1, { Query: "status_code = 404", OrderBy: "", Limit: 2, AsOf: "" });
  const params = new URLSearchParams(sent.at(-1).search);
  assert.equal(params.get("q"), `metadata.armory_run_id = "${R1}" AND (status_code = 404)`);
  assert.equal(params.get("order_by"), "requested_at");
  assert.deepEqual(params.getAll("exclude"), []);
  assert.equal(sent.some((req) => req.path.startsWith("/settings")), false);
  assert.deepEqual(
    page.Items.map((item) => [item.ID, item.StatusCode, item.Length]),
    [
      [P1, 200, 12],
      [P2, 404, 9],
    ],
  );
  assert.equal(page.NextCursor, P1);
  assert.equal(page.AsOf, P2);
});

test("QueryArmoryRunTraffic with no query reads the whole run", async () => {
  answers["GET /traffic"] = { items: [], next_cursor: null, as_of: null };
  await App.QueryArmoryRunTraffic(R1, { Query: "", OrderBy: "length desc", Cursor: P1, AsOf: P2, Limit: 200 });
  const params = new URLSearchParams(sent.at(-1).search);
  assert.equal(params.get("q"), `metadata.armory_run_id = "${R1}"`);
  assert.equal(params.get("order_by"), "length desc");
  assert.equal(params.get("cursor"), P1);
  assert.equal(params.get("as_of"), P2);
});

test("CountArmoryRunTraffic counts the run's pairs by a field and answers the as_of Marasi counted under", async () => {
  answers["GET /traffic/count/by-field"] = {
    items: [
      { value: "200", count: 30 },
      { value: "404", count: 9 },
      { value: "", count: 1 },
    ],
    as_of: P2,
    index: { complete: true },
  };
  const counts = await App.CountArmoryRunTraffic(R1, "status_code", "");
  const params = new URLSearchParams(sent.at(-1).search);
  assert.equal(params.get("field"), "status_code");
  assert.equal(params.get("q"), `metadata.armory_run_id = "${R1}"`);
  assert.equal(params.has("as_of"), false);
  assert.deepEqual(params.getAll("exclude"), []);
  assert.deepEqual(counts, {
    Counts: [
      { Value: "200", Count: 30 },
      { Value: "404", Count: 9 },
      { Value: "", Count: 1 },
    ],
    AsOf: P2,
  });
});

test("CountArmoryRunTraffic passes an as_of back, so the counts stop where a group's pages do", async () => {
  answers["GET /traffic/count/by-field"] = { items: [{ value: "12", count: 2 }], as_of: P1, index: { complete: true } };
  const counts = await App.CountArmoryRunTraffic(R1, "length", P1);
  const params = new URLSearchParams(sent.at(-1).search);
  assert.equal(params.get("field"), "length");
  assert.equal(params.get("as_of"), P1);
  assert.equal(counts.AsOf, P1);
});

test("CountArmoryRunTraffic answers an empty as_of for a run with no pairs", async () => {
  answers["GET /traffic/count/by-field"] = { items: [], as_of: null, index: { complete: true } };
  assert.deepEqual(await App.CountArmoryRunTraffic(R1, "status_code", ""), { Counts: [], AsOf: "" });
});

test("CountArmoryRunTraffic rejects with Marasi's code for a field it can't count by", async () => {
  answers["GET /traffic/count/by-field"] = () => json({ error: "invalid_count_field", message: "cannot count by host" }, 400);
  await assert.rejects(App.CountArmoryRunTraffic(R1, "host", ""), (err) => err.code === "invalid_count_field");
});

test("GetArmoryRunRequests reads every pair the run sent, page by page, as v1's RequestResponseRow", async () => {
  answers["GET /traffic"] = ({ search }) => {
    const params = new URLSearchParams(search);
    assert.equal(params.get("q"), `metadata.armory_run_id = "${R1}"`);
    return params.get("cursor") === P2
      ? json({ items: [summary(P1, 1, 200, 12)], next_cursor: null, as_of: P2 })
      : json({ items: [summary(P2, 2, 404, 9)], next_cursor: P2, as_of: P2 });
  };
  for (const [id, number] of [
    [P1, 1],
    [P2, 2],
  ]) {
    answers[`GET /traffic/${id}`] = {
      id,
      number,
      request: { scheme: "https", method: "GET", host: "example.com", path: `/${number}`, raw: btoa(`GET /${number} HTTP/1.1`) },
      response: { status_code: 200, raw: btoa("HTTP/1.1 200 OK") },
      metadata: { armory_run_id: R1 },
    };
  }
  const rows = await App.GetArmoryRunRequests(R1);
  assert.deepEqual(
    rows.map((row) => [row.Request.ID, row.Request.Raw]),
    [
      [P1, "GET /1 HTTP/1.1"],
      [P2, "GET /2 HTTP/1.1"],
    ],
  );
});
