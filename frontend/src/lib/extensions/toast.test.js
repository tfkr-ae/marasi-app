import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionToast } from "./toast.js";

test("an extension's toast keeps its message and variant", () => {
  assert.deepEqual(extensionToast({ message: "Done", variant: "success" }), {
    message: "Done",
    background: "variant-filled-success",
  });
});

test("an unknown variant shows as primary", () => {
  assert.equal(extensionToast({ message: "x", variant: "ghost" }).background, "variant-filled-primary");
});
