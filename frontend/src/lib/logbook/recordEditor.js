// Opens the finding and test case modal (RecordModal, registered as
// "LogbookRecord") on an edit session in the Logbook store.
import { get } from "svelte/store";
import { logbookStore } from "../../stores/logbookStore.js";
import { findingStore } from "../../stores/findingStore.js";
import { testCaseStore } from "../../stores/testCaseStore.js";

export const RECORD_MODAL = "LogbookRecord";

const show = (modalStore) => modalStore.trigger({ type: "component", component: RECORD_MODAL });

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
  await logbookStore.populate();
  if (get(modalStore).length) return;
  logbookStore.edit(kind, id);
  if (get(logbookStore).session) show(modalStore);
}

/**
 * Keeps the older finding and test case stores, which the Ledger and the
 * Dashboard still read, in step after a save.
 */
export function refreshOtherLists() {
  findingStore.populate();
  testCaseStore.populate();
}
