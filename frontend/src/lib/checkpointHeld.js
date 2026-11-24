// The app refuses to switch projects while Checkpoint holds an item, since
// Marasi would wait for a held item with nothing on screen to say so, or drop
// one a launch holds (marasi docs/adr/2026-10-17-project-switch-waits-for-held-checkpoint-items.md).
// The app's Go side reports it as "checkpoint_held (<id>, <id>)" inside the
// error's text (errorCodes.js). The ids are the held items.
import { codeIDs } from "./errorCodes.js";

/** The held items a refusal names, or null for any other error. */
export const heldCheckpointIDs = (error) => codeIDs(error, "checkpoint_held");

/**
 * True when a forward or drop failed because the item had already left
 * Checkpoint: "checkpoint_gone (<id>)" in the error's text.
 */
export const isCheckpointGone = (error) => codeIDs(error, "checkpoint_gone") !== null;

/**
 * The confirm modal for a switch or restart refused over held items. Its
 * buttons take the layout's Modal variants; Open Checkpoint calls `open`.
 */
export function checkpointHeldModal(open, { action = "switch projects" } = {}) {
  return {
    type: "confirm",
    title: "Checkpoint has intercepted items",
    body: `Forward or drop them to ${action}.`,
    buttonTextConfirm: "Open Checkpoint",
    buttonTextCancel: "Cancel",
    response: (ok) => {
      if (ok) open();
    },
  };
}

/**
 * Subscribes to the connection store and opens the Checkpoint held-items
 * modal in front of any open modal (such as Connections) whenever a restart
 * is refused over held items.
 */
export function createRestartHeldHandler(modalStore, openCheckpoint) {
  let seen = null;
  return function update(state) {
    const count = state.restartHeld ?? 0;
    if (seen === null) {
      seen = count;
      return;
    }
    if (count <= seen) {
      seen = count;
      return;
    }
    seen = count;
    const modal = checkpointHeldModal(openCheckpoint, { action: "restart" });
    modalStore.update((queue) => [modal, ...queue]);
  };
}
