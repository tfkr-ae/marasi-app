// Changes to pairs: notes, highlights, and bulk actions on a selection in Marasi's shape (launchpads, findings, test cases, deletes, Armory).
import { boundAction } from "../../lib/service/boundAction.js";
import { isSuperseded } from "../../lib/service/errors.js";
import { LAUNCHPADS_EACH_MAX } from "../../lib/ledger/pairs.js";
import { requestCount } from "../../lib/ledger/counts.js";
import { incompleteJobs } from "../../lib/ledger/selectionIncomplete.js";
import { pendingLaunchIDs } from "../../lib/launchPending.js";
import { coveredRows, tableRows } from "./state.js";

/**
 * Bulk changes through `api`. The rows are read again in place afterwards
 * (`refresh`), or patched in place (`patchPairs`) for highlights and notes.
 */
export function createBulk(core, api, { refresh, patchPairs, patchMetadata, selectIDs, clearSelection, pairNumber }) {
  /**
   * Saves `text` as the pair's note, and marks whether the pair has one.
   * Rejects, leaving the mark as it was, when Marasi fails to save it.
   */
  async function saveNote(id, text) {
    await api.updateNote(id, text);
    patchMetadata(id, { has_note: text.length > 0 ? 1 : 0 });
  }

  /**
   * Gives the pairs of `target` (a selection in Marasi's shape, or an array
   * of pair IDs) highlight `number` (1-8), or clears their
   * highlights when it is null, in one bulk call. Marasi emits no event for
   * it, so the loaded rows are repainted here, in place: none move, even
   * when they no longer match the query. Resolves to the number of pairs
   * Marasi changed.
   */
  async function setHighlight(target, number) {
    // A selection (selectionSpec), or the IDs of listed pairs.
    const selection = Array.isArray(target) ? { ids: target.map(String) } : target;
    const changed =
      number == null
        ? await api.clearHighlight(selection)
        : await api.setHighlight(selection, number);
    patchPairs(loadedIn(selection), (item) =>
      (item.Highlight ?? null) !== number ? { ...item, Highlight: number } : item,
    );
    return changed;
  }

  // Runs `fn(id, action)` on each pair in turn, its calls as steps of one
  // action (boundAction.js). A failure is logged and counted, and the rest
  // still run; a connection switch stops them all (superseded).
  async function eachPair(ids, fn) {
    const action = boundAction(api.bind?.());
    const results = [];
    let failed = 0;
    for (const id of ids) {
      try {
        results.push(await fn(id, action));
      } catch (err) {
        if (isSuperseded(err)) throw err;
        console.error(`Acting on pair ${id} failed:`, err);
        failed += 1;
      }
    }
    return { done: results.length, failed, results };
  }

  // The IDs of the loaded rows a selection covers.
  function loadedIn(selection) {
    if (selection.ids) return selection.ids.map(String);
    const sameResults =
      selection.query === core.current.query.ranQuery &&
      selection.exclusion.join() === core.current.exclusion.join();
    return sameResults ? coveredRows(core.current, selection.as_of) : [];
  }

  // Waits for a bulk operation's count, then reads the rows again in place
  // so they show the change.
  async function changed(operation) {
    const count = await operation;
    await refresh();
    return count;
  }

  // Links or unlinks the selection and a launchpad, finding or test case. A
  // link can change what the query matches.
  function link(selection, kind, id) {
    return changed(api.linkTraffic(selection, { Kind: kind, ID: id }));
  }
  function unlink(selection, kind, id) {
    return changed(api.unlinkTraffic(selection, { Kind: kind, ID: id }));
  }

  // Waits for a delete or a removal from a launchpad. When Marasi refuses it
  // for pairs still launching (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md), nothing changed: the loaded
  // ones become the selection, so the researcher sees which, and the error
  // goes on.
  async function showLaunching(operation) {
    try {
      return await operation;
    } catch (err) {
      const pending = new Set(pendingLaunchIDs(err) ?? []);
      const loaded = tableRows(core.current)
        .map((row) => String(row.ID))
        .filter((id) => pending.has(id));
      if (loaded.length) selectIDs(loaded, loaded[0], loaded[0]);
      throw err;
    }
  }

  /**
   * Deletes the selection from the project, with its notes, links and
   * WebSocket messages, then clears the selection and reads the rows again.
   */
  async function deleteFromProject(selection) {
    const count = await showLaunching(api.deleteTraffic(selection));
    clearSelection();
    await refresh();
    return count;
  }

  /**
   * How many of the selection's pairs are evidence in a finding: for listed
   * pairs from `findings` (each with Requests), for ⌘A by counting the
   * query's pairs linked to a finding.
   */
  async function findingEvidence(selection, findings = []) {
    if (selection.ids) {
      const linked = new Set(findings.flatMap((finding) => (finding.Requests ?? []).map(String)));
      return selection.ids.filter((id) => linked.has(String(id))).length;
    }
    const text = selection.query.trim() ? `(${selection.query}) AND finding:*` : "finding:*";
    const counted = await api.countTraffic(text, "", { AsOf: selection.as_of });
    return counted.QueryError ? 0 : counted.Count;
  }

  // A launchpad named for its pairs: "Request N", or "N requests".
  function launchpadName(ids, numberOf = pairNumber) {
    const numbers = ids.map((id) => numberOf(id));
    if (ids.length === 1) {
      return ["Request " + numbers[0], "Launchpad for Request " + numbers[0]];
    }
    return [`${ids.length} requests`, "Launchpad for Requests " + numbers.join(", ")];
  }

  /**
   * Creates one launchpad and links the selection to it. Listed pairs name
   * it after their numbers; a ⌘A selection after `count`. `numberOf(id)`
   * gives a pair's number when the caller knows pairs the Ledger hasn't
   * loaded.
   */
  async function sendToNewLaunchpad(selection, count = null, { numberOf = pairNumber } = {}) {
    const name = selection.ids
      ? launchpadName(selection.ids, numberOf)
      : count == null
        ? ["Matching requests", "Launchpad for the matching requests"]
        : [requestCount(count), `Launchpad for ${requestCount(count)}`];
    const action = boundAction(api.bind?.());
    const launchpadId = await action.step(() => api.createLaunchpad(...name));
    let linked;
    try {
      linked = await action.step(() => link(selection, "launchpad", launchpadId));
    } catch (err) {
      // Marasi refused the selection (its query waits on a job still
      // building) and linked nothing: the launchpad goes again rather than
      // stay empty.
      if (incompleteJobs(err)) {
        await action
          .step(() => api.deleteLaunchpad(launchpadId))
          .catch((cause) => console.error("Removing the empty launchpad failed:", cause));
      }
      throw err;
    }
    return { launchpadId, count: linked };
  }

  /** Creates a launchpad for each pair, up to LAUNCHPADS_EACH_MAX. */
  async function sendToLaunchpadsEach(ids) {
    if (ids.length > LAUNCHPADS_EACH_MAX) {
      throw new Error(`One launchpad each works on up to ${LAUNCHPADS_EACH_MAX} requests`);
    }
    const { results, failed } = await eachPair(ids, async (id, action) => {
      const launchpadId = await action.step(() => api.createLaunchpad(...launchpadName([id])));
      await action.step(() => api.linkTraffic({ ids: [String(id)] }, { Kind: "launchpad", ID: launchpadId }));
      return launchpadId;
    });
    await refresh();
    return { launchpadIds: results, done: results.length, failed };
  }

  return {
    saveNote,
    setHighlight,

    // Bulk actions on a selection in Marasi's shape (selectionSpec): one
    // call each, which resolves to how many pairs Marasi changed. Marasi
    // emits no event for them, so the rows are read again in place.
    sendToNewLaunchpad,
    sendToLaunchpadsEach,
    addToLaunchpad: (selection, id) => link(selection, "launchpad", id),
    removeFromLaunchpad: (selection, id) => showLaunching(unlink(selection, "launchpad", id)),
    linkToFinding: (selection, id) => link(selection, "finding", id),
    unlinkFromFinding: (selection, id) => unlink(selection, "finding", id),
    linkToTestCase: (selection, id) => link(selection, "test_case", id),
    unlinkFromTestCase: (selection, id) => unlink(selection, "test_case", id),
    /** Adds `text` to each pair's note, after a blank line when it has one. */
    appendNote: (selection, text) => changed(api.appendNote(selection, text)),
    clearNotes: (selection) => changed(api.clearNotes(selection)),
    deleteFromProject,
    findingEvidence,
    /** One Armory template per pair; `results` holds the templates made. */
    sendToArmory: (ids) => eachPair(ids, (id, action) => action.step(() => api.sendToArmory(id))),
  };
}
