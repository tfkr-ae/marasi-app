// Opens the finding and test case modal (RecordModal, registered as
// "LogbookRecord") on an edit session in the Logbook store.
import { get } from "svelte/store";
import { logbookStore } from "../../stores/logbookStore.js";

export const RECORD_MODAL = "LogbookRecord";

const show = (modalStore) => modalStore.trigger({ type: "component", component: RECORD_MODAL });

/**
 * Opens the modal on a session the store started by itself: an inline
 * fix's input whose record was deleted elsewhere. Does nothing while a
 * modal is open or without such a session.
 */
export function showMovedSession(modalStore) {
  if (get(modalStore).length || get(logbookStore).session?.remote !== "deleted") return;
  show(modalStore);
}

/**
 * Opens a new "finding" or "testCase", pre-filled with `requestIds` and,
 * for a finding, `testCaseId`. Every entry point (the Logbook, the Ledger,
 * the Armory, the request view, a test case's + Finding) starts here, so
 * nothing is created until Save. Does nothing while another modal is open.
 */
export function newRecord(modalStore, kind, preset = {}) {
  if (get(modalStore).length) return;
  logbookStore.startNew(kind, preset);
  show(modalStore);
}

/**
 * Opens the "finding" or "testCase" with `id`, read afresh so links made
 * elsewhere (the Ledger) show. Does nothing while another modal is open.
 */
export async function editRecord(modalStore, kind, id) {
  if (get(modalStore).length) return;
  await logbookStore.reload(kind, id).catch((err) => console.error("Rereading the record failed:", err));
  if (get(modalStore).length) return;
  logbookStore.edit(kind, id);
  if (get(logbookStore).session) show(modalStore);
}
