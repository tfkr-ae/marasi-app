import { test } from "node:test";
import assert from "node:assert/strict";
import { luaErrorText } from "./luaError.js";

test("a Lua error shows the interpreter's message", () => {
  const error = Object.assign(new Error("POST /extension/x: lua_error: <string>:1: unexpected symbol"), {
    code: "lua_error",
    body: { error: "lua_error", message: "<string>:1: unexpected symbol" },
  });
  assert.equal(luaErrorText(error), "<string>:1: unexpected symbol");
});

test("any other failure shows its whole text", () => {
  assert.equal(luaErrorText(new Error("POST /extension/x: not_found: HTTP 404")), "POST /extension/x: not_found: HTTP 404");
});
