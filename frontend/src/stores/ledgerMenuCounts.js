// The Ledger toolbar's Highlights and Marks menu counts (see
// createMatchCounts): they start soon after a project load or resync; new
// traffic or another client's change marks them stale, and recounts only a
// menu that is open; a switch forgets the last project's. Opening a menu
// recounts it at once, keeping the last numbers, dimmed.
import { service } from "../lib/service/index.js";
import { HIGHLIGHT_TERMS } from "../lib/ledger/highlights.js";
import { MARKS } from "../lib/ledger/marks.js";
import { createMatchCounts } from "./createMatchCounts.js";
import { followCountChanges } from "./countChanges.js";
import { ledgerStore } from "./ledgerStore";
import { projectData } from "./projectData.js";

const count = (query) => ledgerStore.countQuery(query);

/** { [highlight term]: count } for the Highlights menu. */
export const highlightCounts = createMatchCounts({ queries: () => HIGHLIGHT_TERMS, count });
/** { [mark term]: count } for the Marks menu. */
export const markCounts = createMatchCounts({ queries: () => MARKS.map((mark) => mark.term), count });

const all = [highlightCounts, markCounts];
const schedule = () => all.forEach((counts) => counts.schedule());

projectData.register("ledgerMenuCounts", {
  clear: () => all.forEach((counts) => counts.clear()),
  load: schedule,
});
followCountChanges(service, () => all.forEach((counts) => counts.changed()));
