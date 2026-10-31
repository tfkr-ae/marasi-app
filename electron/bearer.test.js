import { test } from "node:test";
import assert from "node:assert/strict";
import { withBearer } from "./bearer.js";

const token = "a".repeat(64);
// Window 1 is connected to the instance at 127.0.0.1:50037.
const connectionOf = (webContentsId) =>
  webContentsId === 1 ? { origin: "http://127.0.0.1:50037", token } : null;

const request = (url, webContentsId = 1, requestHeaders = { Accept: "*/*" }) => ({ url, webContentsId, requestHeaders });

test("a window's request to its instance carries the token", () => {
  assert.deepEqual(withBearer(request("http://127.0.0.1:50037/service/status"), connectionOf), {
    Accept: "*/*",
    Authorization: `Bearer ${token}`,
  });
  assert.equal(withBearer(request("http://127.0.0.1:50037/events?x=1"), connectionOf).Authorization, `Bearer ${token}`);
});

test("a request to any other origin carries no token", () => {
  for (const url of [
    "http://127.0.0.1:50038/service/status",
    "https://127.0.0.1:50037/service/status",
    "http://localhost:50037/service/status",
    "http://127.0.0.1:50037.evil.test/service/status",
    "http://example.com/?http://127.0.0.1:50037/",
    "app://marasi/",
  ]) {
    assert.equal(withBearer(request(url), connectionOf).Authorization, undefined, url);
  }
});

test("a request from another window carries no token", () => {
  assert.equal(withBearer(request("http://127.0.0.1:50037/service/status", 2), connectionOf).Authorization, undefined);
  assert.equal(withBearer(request("http://127.0.0.1:50037/service/status", null), connectionOf).Authorization, undefined);
});

test("a token the page set itself is replaced", () => {
  const headers = withBearer(request("http://127.0.0.1:50037/x", 1, { authorization: "Bearer stolen" }), connectionOf);
  assert.deepEqual(headers, { Authorization: `Bearer ${token}` });
});

test("with two windows on two instances, each request carries only its own window's token", () => {
  const tokens = { 1: "a".repeat(64), 2: "b".repeat(64) };
  const origins = { 1: "http://127.0.0.1:50037", 2: "http://127.0.0.1:50100" };
  const both = (id) => (tokens[id] ? { origin: origins[id], token: tokens[id] } : null);
  assert.equal(withBearer(request(`${origins[1]}/service/status`, 1), both).Authorization, `Bearer ${tokens[1]}`);
  assert.equal(withBearer(request(`${origins[2]}/service/status`, 2), both).Authorization, `Bearer ${tokens[2]}`);
  assert.equal(withBearer(request(`${origins[2]}/service/status`, 1), both).Authorization, undefined);
  assert.equal(withBearer(request(`${origins[1]}/service/status`, 2), both).Authorization, undefined);
});
