// Compass's and the extensions' ported bindings: the scope rules and tester,
// and the extensions' list, code, runs and logs. Each sends its control API
// route and answers in the shape v1's frontend reads.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

const workshop = {
  id: "01937d13-9632-7f84-add5-14ec2c2c7f43",
  name: "workshop",
  enabled: true,
  author: "TenSoon",
  description: "Lua Workshop",
  source_url: "marasi-internal",
  updated_at: "2026-10-31T21:04:59Z",
};
const compass = { ...workshop, id: "01937d13-9632-72aa-83b9-c10ea1abbdd6", name: "compass" };

// The connected instance answers each route from `answers`, by "METHOD path":
// a body, or a [status, body] pair.
beforeEach(() => {
  sent = [];
  answers = { "GET /extension": { items: [compass, workshop] } };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = answers[`${method} ${path}`] ?? {};
    const [status, body] = Array.isArray(answer) ? answer : [200, answer];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("GetScopeRules reads the scope rules in v1's shape", async () => {
  answers["GET /scope"] = {
    default_allow: false,
    include: [{ pattern: "example\\.com", match_type: "host" }],
    exclude: [{ pattern: ".*\\.gstatic\\.com", match_type: "host" }, { pattern: ".*logout.*", match_type: "url" }],
  };
  assert.deepEqual(await App.GetScopeRules(), {
    defaultAllow: false,
    includeRules: [{ pattern: "example\\.com", matchType: "host" }],
    excludeRules: [
      { pattern: ".*\\.gstatic\\.com", matchType: "host" },
      { pattern: ".*logout.*", matchType: "url" },
    ],
  });
});

test("TestScopeMatch names an exclude rule that keeps a URL out of scope", async () => {
  answers["POST /scope/check"] = {
    in_scope: false,
    tested_url: "https://foo.gstatic.com/x",
    rule: { pattern: ".*\\.gstatic\\.com", match_type: "host" },
    compass_enabled: true,
  };
  const result = await App.TestScopeMatch("foo.gstatic.com/x");
  assert.deepEqual(sent.at(-1), { method: "POST", path: "/scope/check", body: { url: "foo.gstatic.com/x" } });
  assert.deepEqual(result, {
    inScope: false,
    testedUrl: "https://foo.gstatic.com/x",
    matchedRule: ".*\\.gstatic\\.com",
    matchedAs: "host",
    ruleType: "exclude",
    defaultAllowUsed: false,
    compassEnabled: true,
  });
});

test("TestScopeMatch names an include rule that puts a URL in scope", async () => {
  answers["POST /scope/check"] = {
    in_scope: true,
    tested_url: "https://example.com",
    rule: { pattern: "example\\.com", match_type: "host" },
    compass_enabled: true,
  };
  const result = await App.TestScopeMatch("example.com");
  assert.equal(result.ruleType, "include");
  assert.equal(result.defaultAllowUsed, false);
});

test("TestScopeMatch with no rule matched uses the default", async () => {
  answers["POST /scope/check"] = { in_scope: true, tested_url: "https://a.test", rule: null, compass_enabled: true };
  const result = await App.TestScopeMatch("a.test");
  assert.equal(result.defaultAllowUsed, true);
  assert.equal(result.matchedRule, "");
  assert.equal(result.ruleType, "");
});

test("GetExtensions lists the extensions in v1's shape", async () => {
  assert.deepEqual((await App.GetExtensions())[1], {
    ID: workshop.id,
    Name: "workshop",
    Enabled: true,
    Author: "TenSoon",
    Description: "Lua Workshop",
    SourceURL: "marasi-internal",
    UpdatedAt: "2026-10-31T21:04:59Z",
  });
});

test("GetExtensionCode reads the code of the extension with that name", async () => {
  answers[`GET /extension/${compass.id}`] = { ...compass, lua_content: "-- rules", settings: {} };
  assert.equal(await App.GetExtensionCode("compass"), "-- rules");
});

test("RunExtension saves and runs the code on the extension with that name", async () => {
  await App.RunExtension("workshop", "print('hi')");
  assert.deepEqual(sent.at(-1), {
    method: "POST",
    path: `/extension/${workshop.id}`,
    body: { lua_content: "print('hi')" },
  });
});

test("RunExtension refuses an extension the project doesn't have", async () => {
  await assert.rejects(App.RunExtension("missing", ""), /extension missing not found/);
});

test("RunExtension rejects with Marasi's lua_error", async () => {
  answers[`POST /extension/${workshop.id}`] = [400, { error: "lua_error" }];
  await assert.rejects(App.RunExtension("workshop", "error('boom')"), /lua_error/);
});

test("DoExtender runs the code on the workshop", async () => {
  await App.DoExtender("print('x')");
  assert.deepEqual(sent.at(-1).path, `/extension/${workshop.id}`);
});

test("GetExtensionLogs reads an extension's log buffer in v1's shape", async () => {
  answers[`GET /extension/${workshop.id}/logs`] = { items: [{ time: "2026-11-01T01:05:27+04:00", text: "hi" }] };
  assert.deepEqual(await App.GetExtensionLogs("workshop"), [{ Time: "2026-11-01T01:05:27+04:00", Text: "hi" }]);
});

test("LoadExtensions has nothing to set up", async () => {
  await App.LoadExtensions();
  assert.deepEqual(sent, []);
});
