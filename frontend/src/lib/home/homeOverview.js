// Binds overviewOf to the app's stores, and opens a figure's destination.
import { derived, get } from "svelte/store";
import { goto } from "$app/navigation";
import { interceptFlag } from "../../stores/interceptFlag.js";
import { homeStore } from "../../stores/homeStore.js";
import { checkpointStore } from "../../stores/checkpointStore.js";
import { activeCountsOf, armoryStore } from "../../stores/armoryStore.js";
import { testCaseStore } from "../../stores/testCaseStore.js";
import { findingStore } from "../../stores/findingStore.js";
import { ledgerStore } from "../../stores/ledgerStore.js";
import { logbookStore } from "../../stores/logbookStore.js";
import { completenessOf } from "../../stores/createLogbookStore.js";
import { startListener } from "../globalActions.js";
import { overviewOf } from "./overview.js";

/** The Overview of the open project, current with the stores. */
export const overview = derived(
  [homeStore, checkpointStore, interceptFlag, armoryStore, testCaseStore, findingStore],
  ([$home, $checkpoint, $interceptAll, $armory, $testCases, $findings]) =>
    overviewOf({
      dashboard: $home.dashboard,
      scope: $home.scope,
      held: $checkpoint.items.length,
      interceptAll: $interceptAll,
      activeRuns: activeCountsOf($armory).total,
      testCases: $testCases.map((t) => ({ done: completenessOf("testCase", t).status === "done" })),
      findings: $findings.map((f) => ({ severity: f.Severity, done: completenessOf("finding", f).status === "done" })),
      listenerStopped: $home.listenerStopped,
    }),
);

/**
 * Opens the page a figure counts, filtered so its rows match the figure,
 * or does a Pending item's action (`toastStore` announces a listener start).
 */
export async function openDestination(destination, { toastStore } = {}) {
  if (destination.action === "start-listener") {
    if (!get(homeStore).listenerBusy) await startListener(toastStore);
    return;
  }
  if (destination.page === "ledger") {
    await goto("/ledger");
    ledgerStore.setQueryText(destination.query);
    ledgerStore.runQuery(destination.query);
    return;
  }
  if (destination.page === "logbook") {
    logbookStore.clearFilters();
    logbookStore.setKind(destination.kind);
    if (destination.severities?.length) logbookStore.setSeverities(destination.severities);
    if (destination.status) logbookStore.setStatus(destination.status);
    await goto("/logbook");
    return;
  }
  await goto(`/${destination.page}`);
}
