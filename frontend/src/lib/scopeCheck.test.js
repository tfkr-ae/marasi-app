import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScope } from "./scopeCheck.js";
import { serviceError } from "./service/errors.js";

// A client whose POST /scope/check answers with `answer(body)`.
const clientAnswering = (answer) => ({
  calls: [],
  async post(path, body) {
    this.calls.push([path, body]);
    assert.equal(path, "/scope/check");
    return answer(body);
  },
});

test("a URL an include rule matched is in scope by that rule", async () => {
  const client = clientAnswering(() => ({
    in_scope: true,
    tested_url: "https://example.com/a",
    rule: { pattern: "example\\.com", match_type: "host" },
    compass_enabled: true,
  }));
  assert.deepEqual(await checkScope(client, "example.com/a"), {
    inScope: true,
    matchedRule: "example\\.com",
    ruleType: "include",
    matchedAs: "host",
    defaultAllowUsed: false,
    testedUrl: "https://example.com/a",
  });
  assert.deepEqual(client.calls, [["/scope/check", { url: "example.com/a" }]]);
});

test("a URL an exclude rule matched is out of scope by that rule", async () => {
  const client = clientAnswering(() => ({
    in_scope: false,
    tested_url: "https://x.test/logout",
    rule: { pattern: "/logout", match_type: "url" },
    compass_enabled: true,
  }));
  const result = await checkScope(client, "https://x.test/logout");
  assert.equal(result.ruleType, "exclude");
  assert.equal(result.matchedAs, "url");
  assert.equal(result.inScope, false);
});

test("no matching rule falls back to the default policy", async () => {
  const client = clientAnswering(() => ({ in_scope: true, tested_url: "https://y.test", rule: null, compass_enabled: false }));
  const result = await checkScope(client, "y.test");
  assert.equal(result.defaultAllowUsed, true);
  assert.equal(result.matchedRule, "");
  assert.equal(result.inScope, true);
});

test("a URL the service can't parse is reported as an error", async () => {
  const client = clientAnswering(() => {
    throw serviceError({ method: "POST", path: "/scope/check", status: 400, body: { error: "bad_request" } });
  });
  assert.deepEqual(await checkScope(client, "http://[::1"), { error: "Invalid URL" });
});

test("other failures pass on", async () => {
  const client = clientAnswering(() => {
    throw serviceError({ method: "POST", path: "/scope/check", status: 500, body: { error: "internal_server_error" } });
  });
  await assert.rejects(checkScope(client, "a.test"), /internal_server_error/);
});
