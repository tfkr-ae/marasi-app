// Bulk link changes through the Wails backend reread the Logbook lists they
// touch, so a menu's checkmarks are right the next time it opens. The Ledger
// and Launchpad stores' API mappings share it.
import { findingStore } from "./findingStore";
import { testCaseStore } from "./testCaseStore";

/**
 * Waits for a bulk call, then rereads the finding or test case lists whose
 * links it changed (`kind` "finding", "test_case", or "all" for both).
 * Resolves to the call's count.
 */
export async function relinked(call, kind) {
  const count = await call;
  const stores = { finding: [findingStore], test_case: [testCaseStore], all: [findingStore, testCaseStore] };
  for (const store of stores[kind] ?? []) {
    store.populate().catch((err) => console.error("Rereading links failed:", err));
  }
  return count;
}
