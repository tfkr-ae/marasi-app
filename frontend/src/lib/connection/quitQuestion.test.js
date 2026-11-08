// The quit question's names and answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namedConnections, quitAnswerOf } from "./quitQuestion.js";

test("one owned connection isn't named", () => {
  assert.deepEqual(namedConnections({ connections: ["Local"] }), []);
});

test("several owned connections are all named", () => {
  assert.deepEqual(namedConnections({ connections: ["Local", "Lab instance"] }), ["Local", "Lab instance"]);
});

test("a button's answer reaches Go with Don't ask again", () => {
  assert.deepEqual(quitAnswerOf({ answer: "stop", remember: true }), { answer: "stop", remember: true });
  assert.deepEqual(quitAnswerOf({ answer: "keep", remember: false }), { answer: "keep", remember: false });
});

test("closing the modal without a button cancels the quit and saves nothing", () => {
  assert.deepEqual(quitAnswerOf(undefined), { answer: "cancel", remember: false });
  assert.deepEqual(quitAnswerOf(false), { answer: "cancel", remember: false });
  assert.deepEqual(quitAnswerOf({ answer: "cancel", remember: true }), { answer: "cancel", remember: false });
});
