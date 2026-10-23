// The app refuses to switch projects while Checkpoint holds an item, since
// Marasi would wait for a held item with nothing on screen to say so, or drop
// one a launch holds (marasi docs/adr/2026-10-17-project-switch-waits-for-held-checkpoint-items.md).
// The app's Go side reports it as "checkpoint_held (<id>, <id>)" inside the
// error's text (errorCodes.js). The ids are the held items.
import { codeIDs } from "./errorCodes.js";

/** The held items a refusal names, or null for any other error. */
export const heldCheckpointIDs = (error) => codeIDs(error, "checkpoint_held");

/**
 * The confirm modal for a switch refused over held items. Its buttons take
 * the layout's Modal variants; Open Checkpoint calls `open`.
 */
export function checkpointHeldModal(open) {
  return {
    type: "confirm",
    title: "Checkpoint has intercepted items",
    body: "Forward or drop them to switch projects.",
    buttonTextConfirm: "Open Checkpoint",
    buttonTextCancel: "Cancel",
    response: (ok) => {
      if (ok) open();
    },
  };
}
