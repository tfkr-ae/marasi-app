// Reading a pairing payload (`marasi service control pair --json`, or
// another app's Share) into the remote connection it adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePairing } from "./pairing.js";

test("a payload with a password adds a remote named for its instance and host", () => {
  assert.deepEqual(parsePairing('{"url":"http://100.101.12.4:8443","password":"s3cret","instance":"default"}'), {
    name: "default @ 100.101.12.4",
    url: "http://100.101.12.4:8443",
    password: "s3cret",
    noPassword: false,
  });
});

test("a payload without a password is a service with no password", () => {
  const added = parsePairing(' {"url":"http://10.0.0.5:9000/","instance":"lab"} ');
  assert.equal(added.noPassword, true);
  assert.equal(added.password, "");
  assert.equal(added.url, "http://10.0.0.5:9000");
  assert.equal(added.name, "lab @ 10.0.0.5");
});

test("anything else isn't a pairing payload", () => {
  for (const text of ["", "hello", "[]", '{"password":"x"}', '{"url":"ftp://h:1"}', '{"url":"not a url"}']) {
    assert.throws(() => parsePairing(text), /isn't a pairing payload/, text);
  }
});
