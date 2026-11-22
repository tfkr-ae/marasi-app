import { test } from "node:test";
import assert from "node:assert/strict";
import { superseded } from "../service/errors.js";
import { reportFailure, settleItem } from "./settle.js";

const recorder = () => {
  const toasts = [];
  return { toasts, toast: (message, background) => toasts.push([message, background]) };
};

test("a Forward or Drop toasts the outcomes the researcher must know about, and nothing when it went through", async () => {
  const cases = [
    ["forwarded", []],
    ["unparsed", [["Edit doesn't parse", "variant-filled-warning"]]],
    ["refused", [["Refused by Marasi", "variant-filled-warning"]]],
    ["gone", [["Already gone", "variant-filled-surface"]]],
  ];
  for (const [result, expected] of cases) {
    const { toasts, toast } = recorder();
    assert.equal(await settleItem("Forward", async () => result, toast), result);
    assert.deepEqual(toasts, expected, result);
  }
});

test("a failed call toasts what failed, never the service's text; a superseded one shows nothing", async () => {
  const logged = console.error;
  console.error = () => {};
  try {
    const { toasts, toast } = recorder();
    await settleItem("Drop", async () => {
      throw new Error("POST /checkpoint/x/drop: internal_server_error: boom");
    }, toast);
    await settleItem("Drop", async () => {
      throw superseded("POST /checkpoint/x/drop");
    }, toast);
    reportFailure("Stream intercept", new Error("refused"), toast);
    assert.deepEqual(toasts, [
      ["Drop failed", "variant-filled-error"],
      ["Stream intercept failed", "variant-filled-error"],
    ]);
  } finally {
    console.error = logged;
  }
});
