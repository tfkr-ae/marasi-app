// The Ledger's row-menu actions on a selection: bulk changes, copies, narrowing and hiding, and the toasts and confirmations that report them.
import { goto } from "$app/navigation";
import { get } from "svelte/store";
import { modeCurrent } from "@skeletonlabs/skeleton";
import { canOpenDrawerStream } from "../websocket/presentation.js";
import { curlCommand, markdownTable, narrowQuery, pairURL, similarIDs } from "./rowMenu.js";
import { linkedText, plural, requestCount, unchangedText } from "./counts.js";
import { LAUNCHPADS_EACH_MAX, sameID } from "./pairs.js";
import {
	handoffBackground as handoffStyle,
	toastError as showError,
	toastJump as showJump,
} from "../toasts.js";
import { incompleteJobs, incompleteText } from "./selectionIncomplete.js";
import { toastLaunchingRefusal } from "../launchPending.js";
import { BROWSER_VIEW_COPIED, browserViewURL } from "../browserView.js";
import { sitemapStore } from "../../stores/sitemapStore";
import { launchpadStore } from "../../stores/launchpadStore";
import { UNTITLED_LAUNCHPAD } from "../launchpad/format.js";
import { highlightPalette } from "../../stores/highlightsStore";
import { findingStore } from "../../stores/findingStore";
import { RAW_ONLY } from "../../stores/trafficApi.js";
import { newRecord } from "../logbook/recordEditor.js";
import {
	ledgerStore,
	tableRows,
	focusedPair,
	drawerKeybindingState,
	selectionSize,
} from "../../stores/ledgerStore";

/**
 * The actions over the page's toast and modal stores. `isDrawerOpen()` is
 * the page's drawer state; `showInDrawer(id, pane)` shows a pair's note or
 * metadata in the drawer.
 */
export function createLedgerActions({ toastStore, modalStore, isDrawerOpen, showInDrawer }) {
	// The toast style the Ledger's handoffs use.
	const handoff = () => handoffStyle(get(modeCurrent));

	function copyText(text, done, failed) {
		navigator.clipboard
			.writeText(text ?? "")
			.then(() => toastStore.trigger({ message: done, background: "variant-filled-success" }))
			.catch(() => toastError(failed));
	}

	const toastError = (message, error) => showError(toastStore, message, error);

	// A bulk change that failed. When Marasi refused a ⌘A selection because
	// its query waits on a job still building, nothing changed: it says so
	// and offers to run `retry` again.
	function bulkFailed(message, error, retry) {
		const jobs = incompleteJobs(error);
		if (!jobs) return toastError(message, error);
		toastStore.trigger({
			message: `${message}: ${incompleteText(jobs)}`,
			background: "variant-filled-warning",
			timeout: 10000,
			action: { label: "Retry", response: retry },
		});
	}

	// A delete or removal Marasi refused for pairs still launching (marasi
	// docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md): nothing changed, the store selected the loaded ones, and
	// the launchpads are read again so the menu greys it next time. False
	// for any other error.
	function launchingRefused(error, verb) {
		if (!toastLaunchingRefusal(toastStore, error, verb)) return false;
		refreshLaunchpads();
		return true;
	}

	// A toast with a button that leaves for another page.
	function toastJump(message, label, path) {
		showJump(toastStore, message, label, get(modeCurrent), () => goto(path));
	}

	// "Request 4", or "3 requests".
	function describe(pairs) {
		return pairs.length === 1
			? `Request ${ledgerStore.pairNumber(pairs[0].ID)}`
			: requestCount(pairs.length);
	}

	// Adds " (N failed)" when some per-pair calls failed.
	const failures = ({ failed }) => (failed ? ` (${failed} failed)` : "");

	const idsOf = (pairs) => pairs.map((pair) => pair.ID);

	// "Request 4", "3 requests", or after ⌘A "all 1,200 matching requests".
	function describeTarget(target) {
		if (!target.all) return describe(target.pairs);
		return target.count == null ? "all matching requests" : `all ${requestCount(target.count)}`;
	}

	// A change Marasi says touched no pair. A listed selection's menu already
	// disables what it knows would change nothing, so it says nothing; a ⌘A
	// selection's pairs aren't all loaded, so it says why.
	function unchanged(target, change) {
		if (!target.all) return;
		toastStore.trigger({ message: unchangedText(change, target.count), background: handoff() });
	}

	// The row menu's confirmation modal; `onConfirm` runs only once confirmed.
	function confirm(title, body, buttonTextConfirm, onConfirm) {
		modalStore.trigger({
			type: "confirm",
			title,
			body,
			buttonTextConfirm,
			response: (ok) => ok && onConfirm(),
		});
	}

	// The focused pair's raw request and response.
	function focusedDetails() {
		const focused = focusedPair(get(ledgerStore));
		return focused ? ledgerStore.getDetails(focused.ID, RAW_ONLY) : Promise.reject(new Error("no pair"));
	}

	async function openWebSocketStream() {
		if (!isDrawerOpen() || !canOpenDrawerStream(drawerKeybindingState(get(ledgerStore)).meta) || get(modalStore)[0]) return;
		const details = await focusedDetails();
		modalStore.trigger({
			type: "component",
			component: "WebsocketStream",
			toggleAction: "ledger.drawer-open.websocket.open-stream",
			meta: {
				upgradeRequest: structuredClone({
					Metadata: details.Metadata,
					Request: details.Request,
					Response: get(ledgerStore).selection.incomingResponse || details.Response,
				}),
			},
		});
	}

	// Each action below works on the pairs it is given: the selection, from
	// the row menu or a shortcut. They make one call per pair and report
	// through a toast.

	async function sendToArmory(pairs) {
		let result;
		try {
			result = await ledgerStore.sendToArmory(idsOf(pairs));
		} catch (error) {
			return toastError(`Failed to send ${describe(pairs)} to Armory`, error);
		}
		if (result.done === 0) return toastError(`Failed to send ${describe(pairs)} to Armory`);
		const first = result.results[0];
		toastJump(`${describe(pairs)} sent to Armory${failures(result)}`, "Jump to Armory", `/armory?id=${first.ID}`);
	}

	// The launchpad list in the menu learns about launchpads made here.
	const refreshLaunchpads = () =>
		launchpadStore.populate().catch((err) => console.error("Refreshing launchpads failed:", err));

	async function sendToNewLaunchpad(target) {
		try {
			const result = await ledgerStore.sendToNewLaunchpad(target.selection, target.count);
			refreshLaunchpads();
			toastJump(
				`Sent ${requestCount(result.count)} to a new launchpad`,
				"Jump to Launchpad",
				"/launchpad?id=" + result.launchpadId,
			);
		} catch (error) {
			bulkFailed("Failed to create a launchpad", error, () => sendToNewLaunchpad(target));
		}
	}

	async function sendToLaunchpadsEach(pairs) {
		if (pairs.length > LAUNCHPADS_EACH_MAX) return;
		try {
			const result = await ledgerStore.sendToLaunchpadsEach(idsOf(pairs));
			refreshLaunchpads();
			toastJump(
				`Created ${plural(result.done, "launchpad")}${failures(result)}`,
				"Jump to Launchpad",
				"/launchpad?id=" + (result.launchpadIds[0] ?? ""),
			);
		} catch (error) {
			toastError("Failed to create launchpads", error);
		}
	}

	async function addToLaunchpad(target, launchpadId, name) {
		let count;
		try {
			count = await ledgerStore.addToLaunchpad(target.selection, launchpadId);
		} catch (error) {
			return bulkFailed(`Failed to add ${describeTarget(target)} to "${name}"`, error, () =>
				addToLaunchpad(target, launchpadId, name),
			);
		}
		refreshLaunchpads();
		if (!count) return unchanged(target, { type: "add-to-launchpad", name });
		toastJump(`Added ${requestCount(count)} to "${name}"`, "Jump to Launchpad", "/launchpad?id=" + launchpadId);
	}

	async function removeFromLaunchpad(target, launchpadId, name) {
		try {
			const count = await ledgerStore.removeFromLaunchpad(target.selection, launchpadId);
			refreshLaunchpads();
			if (!count) return unchanged(target, { type: "remove-from-launchpad", name: name || UNTITLED_LAUNCHPAD });
			toastStore.trigger({
				message: `Removed ${requestCount(count)} from "${name || UNTITLED_LAUNCHPAD}"`,
				background: handoff(),
			});
		} catch (error) {
			if (launchingRefused(error, "removed")) return;
			bulkFailed(`Failed to remove ${describeTarget(target)} from "${name}"`, error, () =>
				removeFromLaunchpad(target, launchpadId, name),
			);
		}
	}

	// Links or unlinks the selection and a finding or test case, and says how
	// many pairs Marasi changed (nothing, when it changed none).
	async function changeLinks(target, run, verb, noun, title) {
		let count;
		try {
			count = await run(target.selection);
		} catch (error) {
			return bulkFailed(`Failed to ${verb.toLowerCase()} ${describeTarget(target)}`, error, () =>
				changeLinks(target, run, verb, noun, title),
			);
		}
		const change = { type: verb === "Linked" ? "link" : "unlink", noun, name: title };
		if (!count) return unchanged(target, change);
		toastStore.trigger({ message: linkedText(change, count), background: handoff() });
	}

	// Appends a note to every selected pair's note, after a blank line where
	// one exists.
	function appendNote(target) {
		modalStore.trigger({
			type: "prompt",
			title: "Append a note",
			body: `Adds a paragraph to the notes of ${describeTarget(target)}.`,
			value: "",
			valueAttr: { type: "text", required: true },
			buttonTextSubmit: "Append",
			response: async (text) => {
				if (typeof text !== "string" || !text.trim()) return;
				const append = async () => {
					try {
						const count = await ledgerStore.appendNote(target.selection, text);
						if (!count) return unchanged(target, { type: "append-note" });
						toastStore.trigger({ message: `Appended a note to ${requestCount(count)}`, background: handoff() });
					} catch (error) {
						bulkFailed("Failed to append the note", error, append);
					}
				};
				await append();
			},
		});
	}

	function clearNotes(target) {
		const what = describeTarget(target);
		const clear = async () => {
			try {
				const count = await ledgerStore.clearNotes(target.selection);
				if (!count) return unchanged(target, { type: "clear-notes" });
				toastStore.trigger({ message: `Cleared ${plural(count, "note")}`, background: handoff() });
			} catch (error) {
				bulkFailed("Failed to clear the notes", error, clear);
			}
		};
		confirm("Clear notes?", `Clear the notes on ${what}? This can't be undone.`, "Clear notes", clear);
	}

	// Deletes the selection from the project once confirmed, warning when any
	// of it is evidence in a finding.
	async function deleteFromProject(target) {
		// A ⌘A selection reaches the pairs captured up to when it was made,
		// as they are when it runs: one that has since answered can match.
		const what = target.all
			? target.count == null
				? "all requests that match now"
				: `all ${requestCount(target.count)} that match now`
			: describeTarget(target);
		let evidence = 0;
		try {
			evidence = await ledgerStore.findingEvidence(target.selection, get(findingStore));
		} catch (error) {
			console.error("Checking for finding evidence failed:", error);
		}
		const warning = evidence
			? ` ${evidence === 1 ? "1 of them is" : `${evidence.toLocaleString()} of them are`} evidence in a finding.`
			: "";
		confirm(
			"Delete from project?",
			`Delete ${what} from the project? Their notes, links, WebSocket messages and logs go too. This can't be undone.${warning}`,
			"Delete",
			async function remove() {
				try {
					const count = await ledgerStore.deleteFromProject(target.selection);
					refreshLaunchpads();
					sitemapStore.reload();
					if (!count) return unchanged(target, { type: "delete" });
					toastStore.trigger({ message: `Deleted ${requestCount(count)}`, background: handoff() });
				} catch (error) {
					if (launchingRefused(error, "deleted")) return;
					bulkFailed(`Failed to delete ${what}`, error, remove);
				}
			},
		);
	}

	// Gives the pairs highlight `number`, or clears it when null, and says
	// how many pairs Marasi changed (nothing, when it changed none).
	async function highlightPairs(target, number) {
		const name = number == null ? null : get(highlightPalette)[number - 1]?.label;
		try {
			const changed = await ledgerStore.setHighlight(target.selection, number);
			if (!changed) return unchanged(target, number == null ? { type: "clear-highlight" } : { type: "highlight", name });
			toastStore.trigger({
				message:
					number == null
						? `Cleared the highlight on ${requestCount(changed)}`
						: `Highlighted ${requestCount(changed)} "${name}"`,
				background: handoff(),
			});
		} catch (error) {
			bulkFailed(`Failed to highlight ${describeTarget(target)}`, error, () => highlightPairs(target, number));
		}
	}

	// The context menu's Copy submenu. Raw requests and responses are read
	// when copied, never when the menu opens.
	async function copyPairs(pairs, what) {
		const label = describe(pairs);
		if (what === "urls") {
			return copyText(pairs.map(pairURL).join("\n"), pairs.length === 1 ? "Copied URL" : `Copied ${plural(pairs.length, "URL")}`, "Failed to copy URLs");
		}
		if (what === "markdown") {
			return copyText(markdownTable(pairs, (pair) => ledgerStore.pairNumber(pair.ID)), "Copied a Markdown table", "Failed to copy");
		}
		if (what === "numbers") {
			return copyText(
				pairs.map((pair) => ledgerStore.pairNumber(pair.ID)).join(", "),
				"Copied request numbers",
				"Failed to copy",
			);
		}
		let details;
		try {
			details = await Promise.all(pairs.map((pair) => ledgerStore.getDetails(pair.ID, RAW_ONLY)));
		} catch (error) {
			return toastError(`Failed to read ${label}`, error);
		}
		if (what === "curl") {
			const text = pairs.map((pair, i) => curlCommand(pair, details[i]?.Request?.Raw)).join("\n\n");
			return copyText(text, "Copied as cURL", "Failed to copy");
		}
		if (what === "requests") {
			const text = details.map((d) => d?.Request?.Raw ?? "").join("\n\n");
			return copyText(text, pairs.length === 1 ? "Request copied to clipboard" : `Copied ${label}`, "Failed to copy request");
		}
		if (what === "responses") {
			const incoming = get(ledgerStore).selection.incomingResponse;
			const text = details
				.map((d, i) => {
					const live = incoming && sameID(incoming.ID, pairs[i].ID) ? incoming : null;
					return (live || d?.Response)?.Raw ?? "";
				})
				.filter(Boolean)
				.join("\n\n");
			return copyText(text, pairs.length === 1 ? "Response copied to clipboard" : `Copied the responses of ${label}`, "Failed to copy response");
		}
	}

	// Adds a term to the query and runs it.
	function narrow(term) {
		const text = narrowQuery(get(ledgerStore).queryText, term);
		ledgerStore.setQueryText(text);
		ledgerStore.runQuery(text);
		toastStore.trigger({ message: `Narrowed the query: ${term}`, background: handoff() });
	}

	async function hideType(contentType) {
		const exclusion = get(ledgerStore).exclusion;
		if (exclusion.includes(contentType)) return;
		const before = [...exclusion];
		await ledgerStore.saveExclusion([...before, contentType]);
		const toastId = toastStore.trigger({
			message: `Hid ${contentType}`,
			background: handoff(),
			action: {
				label: "Undo",
				response: () => {
					toastStore.close(toastId);
					ledgerStore.saveExclusion(before);
				},
			},
		});
	}

	function selectSimilar(pairs, kind, number) {
		const ids = similarIDs(kind, tableRows(get(ledgerStore)), pairs, number);
		ledgerStore.selectIDs(ids);
		toastStore.trigger({ message: `Selected ${requestCount(ids.length)}`, background: handoff() });
	}


	/** Runs a row menu action (rowMenu.js) on `target` (selectionTarget). */
	function runMenuAction(action, target) {
		const pairs = target?.pairs ?? [];
		if (!action || pairs.length === 0) return;
		// A ⌘A selection may have been counted since the menu opened.
		if (target.all && target.count == null) target = { ...target, count: selectionSize(get(ledgerStore)) };
		const ids = idsOf(pairs);
		switch (action.type) {
			case "websocket":
				ledgerStore.focusPair(action.id);
				return openWebSocketStream();
			case "new-launchpad":
				return sendToNewLaunchpad(target);
			case "launchpad-each":
				return sendToLaunchpadsEach(pairs);
			case "add-to-launchpad":
				return addToLaunchpad(target, action.id, action.name);
			case "remove-from-launchpad":
				return removeFromLaunchpad(target, action.id, action.name);
			case "armory":
				return sendToArmory(pairs);
			case "new-finding":
				return createFinding(ids);
			case "new-test-case":
				return createTestCase(ids);
			case "link-finding":
				return changeLinks(target, (sel) => ledgerStore.linkToFinding(sel, action.id), "Linked", "finding", action.title);
			case "unlink-finding":
				return changeLinks(target, (sel) => ledgerStore.unlinkFromFinding(sel, action.id), "Unlinked", "finding", action.title);
			case "link-test-case":
				return changeLinks(target, (sel) => ledgerStore.linkToTestCase(sel, action.id), "Linked", "test case", action.title);
			case "unlink-test-case":
				return changeLinks(target, (sel) => ledgerStore.unlinkFromTestCase(sel, action.id), "Unlinked", "test case", action.title);
			case "note":
				return showInDrawer(action.id, "note");
			case "copy":
				return copyPairs(pairs, action.what);
			case "browser-view":
				return copyText(browserViewURL(action.id), BROWSER_VIEW_COPIED, "Failed to copy the browser view URL");
			case "narrow":
				return narrow(action.term);
			case "hide-type":
				return hideType(action.contentType);
			case "highlight":
				return highlightPairs(target, action.number);
			case "select":
				return selectSimilar(pairs, action.kind, action.number);
			case "metadata":
				return showInDrawer(action.id, "metadata");
			case "append-note":
				return appendNote(target);
			case "clear-notes":
				return clearNotes(target);
			case "delete":
				return deleteFromProject(target);
		}
	}

	// A new test case or finding with the pairs as its requests, in the
	// Logbook modal; nothing is created until Save.
	const createTestCase = (ids) => newRecord(modalStore, "testCase", { requestIds: ids });
	const createFinding = (ids) => newRecord(modalStore, "finding", { requestIds: ids });

	return { runMenuAction, highlightPairs, openWebSocketStream, toastError };
}
