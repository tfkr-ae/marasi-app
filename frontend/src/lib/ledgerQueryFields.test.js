import { test } from "node:test";
import assert from "node:assert/strict";
import { QUERY_FIELDS } from "./ledgerQueryFields.js";

test("the field list documents launchpad membership in its three forms", () => {
  const field = QUERY_FIELDS.find((f) => f.name === "launchpad");
  assert.ok(field, "launchpad field listed");
  assert.deepEqual(field.ops, ["=", "!=", ":"]);
  assert.equal(field.example, "launchpad:*");
  for (const form of ['launchpad = "<uuid>"', 'launchpad != "<uuid>"', "launchpad:*"]) {
    assert.ok(field.help.includes(form), `help mentions ${form}`);
  }
});
