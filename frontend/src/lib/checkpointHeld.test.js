import { test } from "node:test";
import assert from "node:assert/strict";
import { checkpointHeldModal, heldCheckpointIDs } from "./checkpointHeld.js";

test("a checkpoint_held refusal names the held items", () => {
  assert.deepEqual(heldCheckpointIDs("Error: opening project: checkpoint_held (a, b): forward or drop …"), ["a", "b"]);
  assert.equal(heldCheckpointIDs("opening project: project_locked: project already open"), null);
});

test("Open Checkpoint opens it and Cancel does nothing", () => {
  let opened = 0;
  const modal = checkpointHeldModal(() => opened++);
  assert.equal(modal.type, "confirm");
  assert.equal(modal.title, "Checkpoint has intercepted items");
  assert.equal(modal.buttonTextConfirm, "Open Checkpoint");
  modal.response(false);
  assert.equal(opened, 0);
  modal.response(true);
  assert.equal(opened, 1);
});
