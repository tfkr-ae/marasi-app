// Moving launchpad entries: where a drop lands and why a move is refused.
// Pure, like treeRows.js: the tree measures rows and passes what it found.
// A place is { launchpadId, before }: the moved entries go before the entry
// `before`, or at the end when it is null (Marasi's MoveLaunchpadEntries).
import { codeIDs } from "../errorCodes.js";
import { launchingHint, pendingLaunchIDs, pendingLaunchText } from "../launchPending.js";

// The first entry at or after `index` in `order` that is not moving, or null
// for the end, so a block dropped inside itself stays put.
function beforeAt(order, moving, index) {
  const skip = new Set(moving);
  return order.slice(index).find((id) => !skip.has(id)) ?? null;
}

/**
 * Where a drop on `hit` lands. `hit` is the row under the pointer: an entry
 * row { kind: "entry", launchpadId, entryId, top, height } or a launchpad
 * row { kind: "launchpad", launchpadId }. `order` is that launchpad's entry
 * ids in entry order and `moving` the ids being moved. The top half of an
 * entry row inserts before it, the bottom half after it; a launchpad row
 * appends. `line` says where the tree draws the insertion line. Returns
 * { launchpadId, before, via, line }, or null off any row.
 */
export function dropTarget({ hit, pointerY, order, moving }) {
  if (hit?.kind === "launchpad") {
    return { launchpadId: hit.launchpadId, before: null, via: "launchpad", line: null };
  }
  if (hit?.kind !== "entry") return null;
  const edge = pointerY < hit.top + hit.height / 2 ? "top" : "bottom";
  const index = order.indexOf(hit.entryId) + (edge === "bottom" ? 1 : 0);
  return {
    launchpadId: hit.launchpadId,
    before: beforeAt(order, moving, index),
    via: "entry",
    line: { entryId: hit.entryId, edge },
  };
}

/**
 * Why the move of `ids` (in launchpad `sourceId`) to `target`
 * ({ launchpadId, via }) is refused, or null. The whole move is refused,
 * never part of it. `pendingIds` are moving entries whose launch is pending,
 * `targetIds` the target's entry ids (null while they load: Marasi then has
 * the last word) and `targetName` its name. Grouped by status or searching,
 * the tree's rows are not in entry order, so only a drop on another
 * launchpad's own row moves.
 */
export function moveRefusal({ sourceId, ids, target, targetName, targetIds, pendingIds, grouped = false, searching = false }) {
  const elsewhere = target.launchpadId !== sourceId;
  if ((grouped || searching) && !(elsewhere && target.via === "launchpad")) {
    return grouped ? "Grouped by status" : "Searching";
  }
  if (!elsewhere) return null;
  const pending = ids.filter((id) => pendingIds.includes(id)).length;
  if (pending) return launchingHint(pending);
  const there = ids.filter((id) => targetIds?.includes(id)).length;
  if (there) return `${there} already in ${targetName}`;
  return null;
}

// Codes in a refused move's error: the app's view of the launchpads was
// stale.
const STALE = [
  ["already_linked", ({ targetName }) => `An entry is already in ${targetName}`],
  ["not_linked", ({ sourceName }) => `An entry is no longer in ${sourceName}`],
  ["invalid_placement", () => "The launchpad changed"],
  // Marasi answers not_found for an entry no longer in the source as well
  // as for a launchpad that is gone.
  ["not_found", () => "The launchpad changed"],
];

/**
 * Why Marasi refused a move, from the binding's error, or null for any
 * other failure. `names` holds the launchpads' sourceName and targetName.
 */
export function marasiMoveRefusal(error, names) {
  const pending = pendingLaunchIDs(error);
  if (pending) return pendingLaunchText(pending.length, "moved", "entry");
  const stale = STALE.find(([code]) => codeIDs(error, code));
  return stale ? `${stale[1](names)}; nothing was moved` : null;
}

/**
 * True when moving `ids` (in their entry order) before `before` (null for
 * the end) leaves `order`, the launchpad's entry ids, as it is.
 */
export function leavesOrder(order, ids, before) {
  const moving = new Set(ids);
  const rest = order.filter((id) => !moving.has(id));
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) return false;
  const next = [...rest.slice(0, at), ...ids, ...rest.slice(at)];
  return next.every((id, index) => id === order[index]);
}
