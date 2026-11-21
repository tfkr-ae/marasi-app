import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./+page.js";

test("/sveltechef redirects to /cyberchef so saved links still work", () => {
  assert.throws(() => load(), (thrown) => {
    assert.equal(thrown.location, "/cyberchef");
    assert.ok(thrown.status >= 300 && thrown.status < 400);
    return true;
  });
});
