import { test } from "node:test";
import assert from "node:assert/strict";
import { checkpointHeldModal, createRestartHeldHandler, heldCheckpointIDs, isCheckpointGone } from "./checkpointHeld.js";

test("a checkpoint_gone refusal reads as an item that already left", () => {
  assert.equal(
    isCheckpointGone("Error: settling Checkpoint item: checkpoint_gone (a): checkpoint item not found: a"),
    true,
  );
  assert.equal(isCheckpointGone(new Error("malformed HTTP request")), false);
});

test("a checkpoint_held refusal names the held items", () => {
  assert.deepEqual(heldCheckpointIDs("Error: opening project: checkpoint_held (a, b): forward or drop …"), ["a", "b"]);
  assert.equal(heldCheckpointIDs("opening project: project_locked: project already open"), null);
});

test("Open Checkpoint opens it and Cancel does nothing", () => {
  let opened = 0;
  const modal = checkpointHeldModal(() => opened++);
  assert.equal(modal.type, "confirm");
  assert.equal(modal.title, "Checkpoint has intercepted items");
  assert.equal(modal.body, "Forward or drop them to switch projects.");
  assert.equal(modal.buttonTextConfirm, "Open Checkpoint");
  assert.equal(modal.buttonTextCancel, "Cancel");
  modal.response(false);
  assert.equal(opened, 0);
  modal.response(true);
  assert.equal(opened, 1);
});

test("checkpointHeldModal supports restart wording", () => {
  let opened = 0;
  const modal = checkpointHeldModal(() => opened++, { action: "restart" });
  assert.equal(modal.type, "confirm");
  assert.equal(modal.title, "Checkpoint has intercepted items");
  assert.equal(modal.body, "Forward or drop them to restart.");
  assert.equal(modal.buttonTextConfirm, "Open Checkpoint");
  assert.equal(modal.buttonTextCancel, "Cancel");
  modal.response(true);
  assert.equal(opened, 1);
});

test("createRestartHeldHandler opens the restart held modal in front of Connections and navigates on confirm", () => {
  let queue = [{ type: "component", component: "Connections" }];
  const modalStore = {
    update: (fn) => (queue = fn(queue)),
    clear: () => (queue = []),
  };
  const navigated = [];
  const update = createRestartHeldHandler(modalStore, () => {
    modalStore.clear();
    navigated.push("/checkpoint");
  });

  // Initial subscribe snapshot does not spuriously trigger.
  update({ restartHeld: 0 });
  assert.equal(queue.length, 1);

  // Incrementing restartHeld puts the confirm modal at the front of the queue.
  update({ restartHeld: 1 });
  assert.equal(queue.length, 2);
  assert.equal(queue[0].title, "Checkpoint has intercepted items");
  assert.equal(queue[0].body, "Forward or drop them to restart.");
  assert.equal(queue[1].component, "Connections");

  // Re-emitting the same count does not duplicate the modal.
  update({ restartHeld: 1 });
  assert.equal(queue.length, 2);

  // Confirming clears Connections and navigates to /checkpoint.
  queue[0].response(true);
  assert.deepEqual(queue, []);
  assert.deepEqual(navigated, ["/checkpoint"]);
});
