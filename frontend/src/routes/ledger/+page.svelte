<script>
	// The Ledger: the sitemap dock (full height), then a one-row toolbar, the
	// windowed table, the drawer below it while a pair is selected, and the
	// status bar. Its state lives in the Ledger store, so the layout and the
	// selection survive page visits.
	import { goto } from "$app/navigation";
	import { onDestroy, tick } from "svelte";
	import { get, writable } from "svelte/store";
	import { lineWrap } from "../../stores";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import {
		Search,
		ToggleLeftIcon,
		SearchIcon,
		FilterIcon,
		ArrowRightIcon,
		ArrowLeftIcon,
		ArrowUpToLineIcon,
		ArrowDownToLineIcon,
		SquareArrowUpRightIcon,
		PenIcon,
		SendIcon,
		CopyIcon,
		GlobeIcon,
		BracesIcon,
		MaximizeIcon,
		WrapTextIcon,
		BookCheckIcon,
		LinkIcon,
		Unlink,
		ShieldAlertIcon,
		Swords,
		RadioIcon,
		X,
		LoaderCircle,
		CircleHelp,
		CircleAlert,
		TriangleAlert,
		PanelLeftIcon,
		MenuIcon,
		Tags,
		Highlighter,
	} from "lucide-svelte";
	import QueryFieldList from "../../lib/components/QueryFieldList.svelte";
	import LedgerQueryBox from "../../lib/ledger/LedgerQueryBox.svelte";
	import SavedQueriesMenu from "../../lib/ledger/SavedQueriesMenu.svelte";
	import { readyMadeQueries } from "../../stores/savedQueriesStore";
	import { appendToQuery } from "../../lib/ledgerQueryFields";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import { canOpenDrawerStream } from "../../lib/websocket/presentation.js";
	import Dock from "../../lib/dock/Dock.svelte";
	import { LEDGER_DOCK } from "../../lib/dock/dock.js";
	import LedgerTable from "../../lib/ledger/LedgerTable.svelte";
	import LedgerSitemap from "../../lib/ledger/LedgerSitemap.svelte";
	import { activeSitemapNode, chooseSitemapNode, excludeSitemapNode, stripLabel } from "../../lib/ledger/sitemap.js";
	import { sitemapStore } from "../../stores/sitemapStore";
	import LedgerDrawer from "../../lib/ledger/LedgerDrawer.svelte";
	import { linkedTo } from "../../lib/ledger/drawer.js";
	import RowMenu from "../../lib/ledger/RowMenu.svelte";
	import {
		curlCommand,
		markdownTable,
		menuAction,
		menuFor,
		narrowQuery,
		pairURL,
		similarIDs,
	} from "../../lib/ledger/rowMenu.js";
	import { plural, requestCount, unchangedText } from "../../lib/ledger/counts.js";
	import { LAUNCHPADS_EACH_MAX, sameID } from "../../lib/ledger/pairs.js";
	import { select } from "../../lib/storeSelect.js";
	import {
		handoffBackground as handoffStyle,
		toastError as showError,
		toastJump as showJump,
	} from "../../lib/toasts.js";
	import { incompleteJobs, incompleteText } from "../../lib/ledger/selectionIncomplete.js";
	import { toastLaunchingRefusal } from "../../lib/launchPending.js";
	import { BROWSER_VIEW_COPIED, browserViewURL } from "../../lib/browserView.js";
	import ToolbarMenu from "../../lib/ledger/ToolbarMenu.svelte";
	import MarksMenu from "../../lib/ledger/MarksMenu.svelte";
	import HighlightsMenu from "../../lib/ledger/HighlightsMenu.svelte";
	import { activeHighlightCount, HIGHLIGHT_TERMS } from "../../lib/ledger/highlights.js";
	import { MARKS, activeMarkCount } from "../../lib/ledger/marks.js";
	import LedgerTypesMenu from "../../lib/ledger/LedgerTypesMenu.svelte";
	import { positionLabel, rowHighlight } from "../../lib/ledger/table.js";
	import { launchpadStore } from "../../stores/launchpadStore";
	import { primaryVariant, UNTITLED_LAUNCHPAD } from "../../lib/launchpad/format.js";
	import { highlightMigrating, highlightPalette, renameHighlight } from "../../stores/highlightsStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { findingStore } from "../../stores/findingStore";
	import { newRecord } from "../../lib/logbook/recordEditor.js";
	import {
		ledgerStore,
		tableRows,
		hiddenByTypeCount,
		focusedPair,
		drawerKeybindingState,
		isQueryActive,
		isLiveNewestFirst,
		indexWarning,
		countLabel,
		newMatchesKind,
		newMatchesLabel,
		allSelectedLabel,
		selectionSize,
		rowMenuTarget,
		selectionTarget as storeSelectionTarget,
	} from "../../stores/ledgerStore";

	// The parts of the Ledger store the page follows. Each notifies only when
	// its own value changes.
	const rows = select(ledgerStore, tableRows);
	const hiddenCount = select(ledgerStore, hiddenByTypeCount);
	const query = select(ledgerStore, (state) => state.query);
	const queryText = select(ledgerStore, (state) => state.queryText);
	const queryPending = select(ledgerStore, (state) => state.queryPending);
	const querying = select(ledgerStore, (state) => state.querying);
	// Ghost rows show only once a read has taken a moment, so a quick one
	// doesn't flash them.
	const GHOST_DELAY_MS = 150;
	let ghost = false;
	let ghostTimer = null;
	$: if ($querying && !ghost && !ghostTimer) {
		ghostTimer = setTimeout(() => {
			ghostTimer = null;
			ghost = true;
		}, GHOST_DELAY_MS);
	} else if (!$querying) {
		clearTimeout(ghostTimer);
		ghostTimer = null;
		ghost = false;
	}
	onDestroy(() => clearTimeout(ghostTimer));
	// An empty table has nothing to flash, so it shows them at once: the
	// first visit lands on the shell with ghost rows while the rows read,
	// or before the read starts while the project is still opening.
	$: ghostRows = ghost || (($querying || $results.loading) && $rows.length === 0);
	const queryActive = select(ledgerStore, (state) => isQueryActive(state.query));
	// The row menu's Hide type adds to it.
	const exclusion = select(ledgerStore, (state) => state.exclusion);
	const selection = select(ledgerStore, (state) => state.selection);
	const focused = select(ledgerStore, focusedPair);
	const drawerLayout = select(ledgerStore, (state) => state.layout.drawer);
	const drawerKeys = select(ledgerStore, drawerKeybindingState);
	const results = select(ledgerStore, (state) => state.results);
	const sort = select(ledgerStore, (state) => state.sort);
	const statusCount = select(ledgerStore, countLabel);
	// The window rows in view, as the table reports them.
	let inView = { first: 0, last: 0 };
	// Whether the query box shows the whole query, wrapped.
	let queryExpanded = false;
	$: position = positionLabel({ start: $results.start, ...inView, empty: $rows.length === 0 });
	const indexNote = select(ledgerStore, indexWarning);
	const newKind = select(ledgerStore, newMatchesKind);
	// The live view: no query typed or running, newest first.
	const inLiveView = select(ledgerStore, (state) => isLiveNewestFirst(state) && !state.queryText);
	const newLabel = select(ledgerStore, newMatchesLabel);

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	let dock;
	let sitemapFind;
	let table;
	let tableArea;
	let queryFieldsOpen = false;
	// The row menu: whether it shows, where, and the pairs it acts on, taken
	// from the selection when it opens.
	// `target` is what the menu's actions run on (see selectionTarget).
	let rowMenu = { open: false, x: 0, y: 0, pairs: [], target: null };
	let typesMenu;

	$: primary = primaryVariant($modeCurrent);
	$: sitemapNode = activeSitemapNode($queryText);
	$: drawerOpen = Boolean($focused);
	// "note" or "metadata" while the drawer shows one in place of the
	// response; a closed drawer reopens on the response.
	let drawerPane = null;
	$: if (!drawerOpen) drawerPane = null;
	$: focusID = $selection.focus;
	$: focusNumber = $focused ? ledgerStore.pairNumber($focused.ID) : "";
	$: selectedCount = $selection.ids.size;
	// "All N matching selected" after ⌘A, else "".
	const allLabel = select(ledgerStore, allSelectedLabel);
	// How many pairs are selected; a ⌘A selection's count arrives after.
	const liveSize = select(ledgerStore, selectionSize);
	// Marasi's error for the text in the query box, underlined there; an
	// error for text since edited is stale.
	$: queryBoxError = $query.error?.query === $queryText ? $query.error : null;
	// Rows are numbered by their position in the results.

	// The toast style the Ledger's handoffs use.
	$: handoffBackground = handoffStyle($modeCurrent);

	// "N new" in the newest-first live view: back to the top, with them.
	function showNewAtTop() {
		ledgerStore.goToTop();
		table?.scrollToTop();
	}

	// A jump to a pair: it is selected and, once the drawer it opens has
	// taken its space, scrolled to the middle when it was out of view. The
	// pair being jumped to skips the keep-in-view scroll below, which would
	// put it at an edge first.
	let jumpingTo = null;
	async function selectAndReveal(id) {
		jumpingTo = String(id);
		ledgerStore.selectPair(id);
		await tick();
		table?.reveal(id, { center: true });
		jumpingTo = null;
	}

	// The focused row stays in view as the selection moves.
	$: if (focusID != null && String(focusID) !== jumpingTo) table?.reveal(focusID);

	function closeDrawer() {
		ledgerStore.clearSelection();
		table?.focus();
	}

	// Esc closes the drawer, unless a modal or a text field has the key.
	function onWindowKeydown(event) {
		if (event.key !== "Escape" || !drawerOpen || $modalStore[0]) return;
		const target = event.target;
		if (target?.closest?.("input, textarea, [contenteditable='true'], .cm-editor")) return;
		event.preventDefault();
		closeDrawer();
	}

	// Drag the drawer's top edge to resize it.
	function startDrawerResize(event) {
		event.preventDefault();
		const rect = tableArea.getBoundingClientRect();
		const move = (e) => ledgerStore.setDrawerSplit((rect.bottom - e.clientY) / rect.height);
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

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
		showJump(toastStore, message, label, $modeCurrent, () => goto(path));
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

	// What an action runs on (selectionTarget in the store).
	const selectionTarget = () => storeSelectionTarget(get(ledgerStore));

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
		toastStore.trigger({ message: unchangedText(change, target.count), background: handoffBackground });
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

	// The focused pair's full request and response.
	function focusedDetails() {
		return $focused ? ledgerStore.getDetails($focused.ID) : Promise.reject(new Error("no pair"));
	}

	async function openWebSocketStream() {
		if (!drawerOpen || !canOpenDrawerStream($drawerKeys.meta) || $modalStore[0]) return;
		const details = await focusedDetails();
		modalStore.trigger({
			type: "component",
			component: "WebsocketStream",
			toggleAction: "ledger.drawer-open.websocket.open-stream",
			meta: {
				upgradeRequest: structuredClone({
					Metadata: details.Metadata,
					Request: details.Request,
					Response: $selection.incomingResponse || details.Response,
				}),
			},
		});
	}

	// Each action below works on the pairs it is given: the selection, from
	// the row menu or a shortcut. They make one call per pair and report
	// through a toast.

	async function sendToArmory(pairs) {
		const result = await ledgerStore.sendToArmory(idsOf(pairs));
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
				background: handoffBackground,
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
		if (!count) return unchanged(target, { type: verb === "Linked" ? "link" : "unlink", noun, name: title });
		const preposition = verb === "Linked" ? "to" : "from";
		toastStore.trigger({
			message: `${verb} ${requestCount(count)} ${preposition} ${noun} "${title}"`,
			background: handoffBackground,
		});
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
						toastStore.trigger({ message: `Appended a note to ${requestCount(count)}`, background: handoffBackground });
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
				toastStore.trigger({ message: `Cleared ${plural(count, "note")}`, background: handoffBackground });
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
			evidence = await ledgerStore.findingEvidence(target.selection, $findingStore);
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
					toastStore.trigger({ message: `Deleted ${requestCount(count)}`, background: handoffBackground });
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
		const name = number == null ? null : $highlightPalette[number - 1]?.label;
		try {
			const changed = await ledgerStore.setHighlight(target.selection, number);
			if (!changed) return unchanged(target, number == null ? { type: "clear-highlight" } : { type: "highlight", name });
			toastStore.trigger({
				message:
					number == null
						? `Cleared the highlight on ${requestCount(changed)}`
						: `Highlighted ${requestCount(changed)} "${name}"`,
				background: handoffBackground,
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
			details = await Promise.all(pairs.map((pair) => ledgerStore.getDetails(pair.ID)));
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
			const incoming = $selection.incomingResponse;
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
		const text = narrowQuery($queryText, term);
		ledgerStore.setQueryText(text);
		ledgerStore.runQuery(text);
		toastStore.trigger({ message: `Narrowed the query: ${term}`, background: handoffBackground });
	}

	async function hideType(contentType) {
		if ($exclusion.includes(contentType)) return;
		const before = [...$exclusion];
		await ledgerStore.saveExclusion([...before, contentType]);
		const toastId = toastStore.trigger({
			message: `Hid ${contentType}`,
			background: handoffBackground,
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
		const ids = similarIDs(kind, $rows, pairs, number);
		ledgerStore.selectIDs(ids);
		toastStore.trigger({ message: `Selected ${requestCount(ids.length)}`, background: handoffBackground });
	}

	// Shows the pair's note or metadata in the drawer, in place of the
	// response (the row menu's Add note…/Edit note… and Metadata).
	function showInDrawer(id, pane) {
		if (!sameID($focused?.ID, id)) ledgerStore.focusPair(id);
		drawerPane = pane;
	}

	// ⌘⇧N and ⌘⇧M: the note or metadata pane, or back to the response.
	function toggleDrawerPane(pane) {
		if ($modalStore[0]) return;
		drawerPane = drawerPane === pane ? null : pane;
	}

	// The drawer's highlight swatches: the focused pair alone, as the row
	// menu's swatches highlight a selection.
	function highlightFocused(number) {
		if (!$focused) return;
		const id = String($focused.ID);
		highlightPairs({ pairs: [$focused], selection: { ids: [id] }, all: false, count: 1 }, number);
	}

	/** Runs a row menu action (rowMenu.js) on `target` (selectionTarget). */
	function runMenuAction(action, target) {
		const pairs = target?.pairs ?? [];
		if (!action || pairs.length === 0) return;
		// A ⌘A selection may have been counted since the menu opened.
		if (target.all && target.count == null) target = { ...target, count: $liveSize };
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

	// Opens the row menu at a point, on the selection or `target`.
	function openRowMenu(x, y, target = selectionTarget()) {
		if (target.pairs.length === 0) return;
		rowMenu = { open: true, x, y, pairs: target.pairs, target };
	}

	// Opens the row menu under the focused row, as ⌘⇧. and the menu key do.
	function openRowMenuAtFocus() {
		if (!drawerOpen || $modalStore[0]) return;
		if (rowMenu.open) {
			rowMenu = { ...rowMenu, open: false };
			return;
		}
		table?.reveal(focusID);
		const rect = table?.rowRect(focusID) ?? tableArea?.getBoundingClientRect();
		if (!rect) return;
		openRowMenu(rect.left + 200, rect.bottom);
	}

	$: rowMenuContext = {
		numberOf: (pair) => ledgerStore.pairNumber(pair.ID),
		launchpads: $launchpadStore.launchpads,
		findings: $findingStore,
		testCases: $testCaseStore,
		palette: $highlightPalette,
		pendingLaunches: Object.values($launchpadStore.launchesById ?? {}).filter((launch) => launch.Status === "pending"),
		all: Boolean(rowMenu.target?.all),
		count: rowMenu.target?.all ? $liveSize : null,
	};

	// A shortcut runs its row menu item on the selection, exactly as choosing
	// it would; when the menu disables it (say, Copy under ⌘A over pairs the
	// table hasn't loaded), it says why instead. The item must carry this
	// `actionId` (menuFor in rowMenu.js), or the shortcut does nothing.
	function runShortcut(actionId) {
		if (!drawerOpen) return;
		rowMenu = { ...rowMenu, open: false };
		const target = selectionTarget();
		if (target.pairs.length === 0) return;
		const context = { ...rowMenuContext, all: target.all, count: target.all ? $liveSize : null };
		const item = menuAction(menuFor(target.pairs, context), actionId);
		if (!item) return;
		if (item.disabled) {
			toastStore.trigger({ message: item.hint, background: "variant-filled-warning", timeout: 2000 });
			return;
		}
		runMenuAction(item.action, target);
	}
	const shortcut = (actionId) => () => runShortcut(actionId);

	// Opens the modal, or closes it when the same one is already open.
	function toggleModal(component, modal) {
		if (!$modalStore[0]) modalStore.trigger(modal);
		else if ($modalStore[0].component === component) modalStore.close();
	}

	// A new test case or finding with the pairs as its requests, in the
	// Logbook modal; nothing is created until Save.
	const createTestCase = (ids) => newRecord(modalStore, "testCase", { requestIds: ids });
	const createFinding = (ids) => newRecord(modalStore, "finding", { requestIds: ids });

	// Focuses `element`, or blurs it when it already has focus.
	function toggleFocus(element) {
		if (!element) return;
		if (document.activeElement === element) element.blur();
		else element.focus();
	}

	const toggleSidebar = {
		icon: PanelLeftIcon,
		handler: () => dock?.toggle(),
	};
	// ⌘⇧\: the sitemap's find box, expanding the dock; again leaves it.
	const focusSitemap = {
		icon: SearchIcon,
		handler: () => {
			if (sitemapFind && document.activeElement === sitemapFind) sitemapFind.blur();
			else dock?.expand(true);
		},
	};

	// Search, Filter and Open request, with the drawer open or closed.
	const focusQuery = { icon: SearchIcon, handler: () => toggleFocus(document.getElementById("searchBox")) };
	const focusExclusion = { icon: FilterIcon, handler: () => typesMenu?.focusFind() };
	const openRequest = (toggleAction) => ({
		icon: SquareArrowUpRightIcon,
		handler: () => {
			new Promise((resolve) => {
				toggleModal("MenuInput", {
					type: "component",
					component: "MenuInput",
					toggleAction,
					title: "Open request",
					response: resolve,
				});
			}).then((requestIndex) => {
				if (!requestIndex) return;
				const number = parseInt(requestIndex);
				ledgerStore.goToNumber(number).then(({ pair }) => {
					if (pair) return selectAndReveal(pair.ID);
					toastStore.trigger({
						message: `No request ${number} in this project`,
						background: "variant-filled-warning",
						timeout: 2500,
					});
				});
			});
		},
	});

	// ⌘] / ⌘[: back to the results' highest- or lowest-numbered request,
	// with the table scrolled to it.
	function goToNumberEnd(highest) {
		modalStore.close();
		ledgerStore.goToNumberEnd(highest).then(({ pair }) => pair && selectAndReveal(pair.ID));
	}

	let ledgerMenu = [
		{
			actionId: "ledger.drawer-closed.toggle-settings",
			icon: ToggleLeftIcon,
			handler: () => (queryFieldsOpen = !queryFieldsOpen),
		},
		{ actionId: "ledger.drawer-closed.focus-query", ...focusQuery },
		{ actionId: "ledger.drawer-closed.focus-exclusion", ...focusExclusion },
		{
			actionId: "ledger.drawer-closed.next-page",
			icon: ArrowRightIcon,
			handler: () => table?.page(1),
		},
		{
			actionId: "ledger.drawer-closed.previous-page",
			icon: ArrowLeftIcon,
			handler: () => table?.page(-1),
		},
		{ actionId: "ledger.drawer-closed.open-request", ...openRequest("ledger.drawer-closed.open-request") },
		{ actionId: "ledger.drawer-closed.toggle-sidebar", ...toggleSidebar },
		{ actionId: "ledger.drawer-closed.focus-sitemap", ...focusSitemap },
	];

	// Each drawer action works on the focused pair.
	const whenOpen = (fn) => () => {
		if (drawerOpen) fn($focused.ID);
	};

	let drawerMenu = [
		{ actionId: "ledger.drawer-open.focus-query", ...focusQuery },
		{ actionId: "ledger.drawer-open.focus-exclusion", ...focusExclusion },
		{ actionId: "ledger.drawer-open.open-request", ...openRequest("ledger.drawer-open.open-request") },
		{
			actionId: "ledger.drawer-open.next-request",
			icon: ArrowRightIcon,
			handler: whenOpen(() => {
				modalStore.close();
				ledgerStore.stepNumber(1);
			}),
		},
		{
			actionId: "ledger.drawer-open.first-result",
			icon: ArrowDownToLineIcon,
			handler: whenOpen(() => goToNumberEnd(false)),
		},
		{
			actionId: "ledger.drawer-open.last-result",
			icon: ArrowUpToLineIcon,
			handler: whenOpen(() => goToNumberEnd(true)),
		},
		{
			actionId: "ledger.drawer-open.send-to-armory",
			icon: Swords,
			handler: shortcut("ledger.drawer-open.send-to-armory"),
		},
		{
			actionId: "ledger.drawer-open.previous-request",
			icon: ArrowLeftIcon,
			handler: whenOpen(() => {
				modalStore.close();
				ledgerStore.stepNumber(-1);
			}),
		},
		{
			actionId: "ledger.drawer-open.send-to-launchpad",
			icon: SendIcon,
			handler: shortcut("ledger.drawer-open.send-to-launchpad"),
		},
		{
			actionId: "ledger.drawer-open.create-test-case",
			icon: BookCheckIcon,
			handler: whenOpen(() => {
				if (!$modalStore[0]) runShortcut("ledger.drawer-open.create-test-case");
			}),
		},
		{
			actionId: "ledger.drawer-open.link-test-case",
			icon: LinkIcon,
			handler: whenOpen((id) => {
				if ($modalStore[0]) {
					if ($modalStore[0].component === "SelectTestCase") modalStore.close();
					return;
				}
				if ($testCaseStore.length === 0) {
					toastStore.trigger({
						message: "No existing test cases found...",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectTestCase",
					toggleAction: "ledger.drawer-open.link-test-case",
					meta: { requestID: id, mode: "link" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.unlink-test-case",
			icon: Unlink,
			handler: whenOpen((id) => {
				if ($modalStore[0]) {
					if ($modalStore[0].component === "SelectTestCase") modalStore.close();
					return;
				}
				if (!$testCaseStore.some((tc) => tc.Requests?.includes(id))) {
					toastStore.trigger({
						message: "No test cases linked to this request.",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectTestCase",
					toggleAction: "ledger.drawer-open.unlink-test-case",
					meta: { requestID: id, mode: "unlink" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.create-finding",
			icon: ShieldAlertIcon,
			handler: whenOpen(() => {
				if (!$modalStore[0]) runShortcut("ledger.drawer-open.create-finding");
			}),
		},
		{
			actionId: "ledger.drawer-open.link-finding",
			icon: LinkIcon,
			handler: whenOpen((id) => {
				if ($modalStore[0]) {
					if ($modalStore[0].component === "SelectFinding") modalStore.close();
					return;
				}
				if ($findingStore.length === 0) {
					toastStore.trigger({
						message: "No existing findings found...",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectFinding",
					toggleAction: "ledger.drawer-open.link-finding",
					meta: { requestID: id, mode: "link" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.unlink-finding",
			icon: Unlink,
			handler: whenOpen((id) => {
				if ($modalStore[0]) {
					if ($modalStore[0].component === "SelectFinding") modalStore.close();
					return;
				}
				if (!$findingStore.some((fnd) => fnd.Requests?.includes(id))) {
					toastStore.trigger({
						message: "No findings linked to this request.",
						background: "variant-filled-warning",
					});
					return;
				}
				modalStore.trigger({
					type: "component",
					component: "SelectFinding",
					toggleAction: "ledger.drawer-open.unlink-finding",
					meta: { requestID: id, mode: "unlink" },
				});
			}),
		},
		{
			actionId: "ledger.drawer-open.view-note",
			icon: PenIcon,
			handler: whenOpen(() => toggleDrawerPane("note")),
		},
		{
			actionId: "ledger.drawer-open.view-metadata",
			icon: BracesIcon,
			handler: whenOpen(() => toggleDrawerPane("metadata")),
		},
		{
			actionId: "ledger.drawer-open.copy-url",
			icon: CopyIcon,
			handler: shortcut("ledger.drawer-open.copy-url"),
		},
		{
			actionId: "ledger.drawer-open.copy-raw-request",
			icon: CopyIcon,
			handler: shortcut("ledger.drawer-open.copy-raw-request"),
		},
		{
			actionId: "ledger.drawer-open.copy-raw-response",
			icon: CopyIcon,
			handler: shortcut("ledger.drawer-open.copy-raw-response"),
		},
		{
			actionId: "ledger.drawer-open.copy-browser-view-url",
			icon: GlobeIcon,
			handler: shortcut("ledger.drawer-open.copy-browser-view-url"),
		},
		{
			actionId: "ledger.drawer-open.open-row-menu",
			icon: MenuIcon,
			handler: openRowMenuAtFocus,
		},
		{
			actionId: "ledger.drawer-open.toggle-fullscreen",
			icon: MaximizeIcon,
			handler: () => ledgerStore.toggleDrawerMaximised(),
		},
		{
			actionId: "ledger.drawer-open.toggle-word-wrap",
			icon: WrapTextIcon,
			handler: () => ($lineWrap = !$lineWrap),
		},
		{ actionId: "ledger.drawer-open.toggle-sidebar", ...toggleSidebar },
		{ actionId: "ledger.drawer-open.focus-sitemap", ...focusSitemap },
	];
	const websocketDrawerMenuItem = {
		actionId: "ledger.drawer-open.websocket.open-stream",
		icon: RadioIcon,
		handler: openWebSocketStream,
	};

	// The drawer's rail and details column run the same handlers as the
	// shortcuts, by action id. Only drawer-open and WebSocket actions are in
	// it, so a rail button with a drawer-closed id does nothing.
	const drawerHandlers = new Map(
		[websocketDrawerMenuItem, ...drawerMenu].map(({ actionId, handler }) => [actionId, handler]),
	);

	// Every Ledger action stays registered; the drawer-closed, drawer-open and
	// WebSocket-upgrade menu contexts decide which ones a key reaches.
	useMenuActions([...ledgerMenu, websocketDrawerMenuItem, ...drawerMenu]);
	// The menu lists the actions of the drawer's current state.
	$: menuOptions = !$drawerKeys.open
		? ledgerMenu
		: canOpenDrawerStream($drawerKeys.meta)
			? [websocketDrawerMenuItem, ...drawerMenu]
			: drawerMenu;

	// Appends a field-list example to the query box and runs it like typing.
	function insertQueryExample(example) {
		const text = appendToQuery($queryText, example);
		ledgerStore.setQueryText(text);
		ledgerStore.scheduleQuery(text);
		document.getElementById("searchBox")?.focus();
	}

	// A toolbar menu's counts for `terms`, read each time it opens: a store
	// of { [term]: count } with `load()`; a newer read wins.
	function menuCounts(terms) {
		const counts = writable({});
		let reads = 0;
		async function load() {
			const read = ++reads;
			counts.set({});
			const result = await ledgerStore.countQueries(terms);
			if (read === reads) counts.set(result);
		}
		return { subscribe: counts.subscribe, load };
	}
	const markCounts = menuCounts(MARKS.map((mark) => mark.term));
	const highlightCounts = menuCounts(HIGHLIGHT_TERMS);
	$: activeMarks = activeMarkCount($queryText);
	$: activeHighlights = activeHighlightCount($queryText);

	function onRenameHighlight({ number, label, allProjects }) {
		renameHighlight(number, label, { allProjects }).catch((error) =>
			toastError(`Failed to rename highlight ${number}`, error),
		);
	}

	// Puts `text` in the query box and runs it at once, or returns to the
	// live view when it is blank: a sitemap choice (choosing a node narrows
	// to it, again removes it, the eye-off button leaves it out) or a saved
	// query the menu chose.
	function applyQuery(text) {
		if (!text.trim()) return ledgerStore.clearQuery();
		ledgerStore.setQueryText(text);
		ledgerStore.runQuery(text);
	}

	// Closes the toolbar's panels on a click outside them.
	function onWindowPointerDown(event) {
		if (queryFieldsOpen && !event.target.closest?.(".ledger-query-fields, #ledgerQueryFieldsToggle")) {
			queryFieldsOpen = false;
		}
	}
</script>

<svelte:window on:keydown={onWindowKeydown} on:pointerdown={onWindowPointerDown} />
<MarasiKeys {menuOptions} />

<div class="ledger-page relative flex h-full min-h-0 overflow-hidden">
	<Dock
		bind:this={dock}
		state={ledgerStore.dockState}
		limits={LEDGER_DOCK}
		stripLabel={stripLabel(sitemapNode)}
		expandLabel="Show the sitemap"
		searchLabel="Search the sitemap"
		collapseLabel="Collapse the sitemap"
		searchInput={sitemapFind}
	>
		<LedgerSitemap
			store={sitemapStore}
			activeNode={sitemapNode}
			queryText={$queryText}
			bind:findInput={sitemapFind}
			on:choose={(e) => applyQuery(chooseSitemapNode($queryText, e.detail))}
			on:exclude={(e) => applyQuery(excludeSitemapNode($queryText, e.detail))}
		/>
	</Dock>

	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Toolbar: the query box, then the menus. -->
		<div
			class="ledger-toolbar relative flex min-h-11 flex-none items-stretch border-b border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
		>
			<!-- An expanded query wraps, and the toolbar grows to show it all. -->
			<div class="flex min-w-0 flex-1 gap-2 pl-3 {queryExpanded ? 'items-start py-3' : 'items-center'}">
				{#if $queryPending || $querying}
					<span
						class="ledger-querying flex shrink-0"
						title="Querying Marasi…"
						role="status"
						aria-label="Querying Marasi"><LoaderCircle size={15} class="animate-spin opacity-70" /></span
					>
				{:else}
					<Search size={15} class="shrink-0 opacity-70" />
				{/if}
				<LedgerQueryBox
					bind:expanded={queryExpanded}
					value={$queryText}
					error={queryBoxError}
					readyMade={$readyMadeQueries}
					on:change={(e) => {
						ledgerStore.setQueryText(e.detail);
						ledgerStore.scheduleQuery(e.detail);
					}}
					on:run={() => ledgerStore.runQuery($queryText)}
				/>
				{#if queryBoxError}
					<span
						id="ledgerQueryError"
						class="flex max-w-[24rem] items-center gap-1 text-xs text-error-500"
						role="alert"
						title={queryBoxError.position
							? `Position ${queryBoxError.position}: ${queryBoxError.message}`
							: queryBoxError.message}
						><CircleAlert size={14} class="shrink-0" /><span class="truncate"
							>{queryBoxError.message}</span
						></span
					>
				{:else if $queryActive}
					<span id="ledgerQueryMatchCount" class="whitespace-nowrap text-xs opacity-70"
						>{ghostRows ? "Querying…" : $statusCount}</span
					>
					{#if $indexNote}
						<span
							id="ledgerIndexBuilding"
							class="flex items-center gap-1 whitespace-nowrap text-xs text-warning-800 dark:text-warning-400"
							role="status"
							title="Marasi is still indexing older pairs, so text matches may be missing"
							><TriangleAlert size={13} />{$indexNote}</span
						>
					{/if}
				{/if}
				{#if $highlightMigrating}
					<span
						id="ledgerHighlightMigration"
						class="flex items-center gap-1 whitespace-nowrap text-xs opacity-70"
						role="status"
						><LoaderCircle size={13} class="animate-spin" />Updating old highlights…</span
					>
				{/if}
				{#if $queryText}
					<button
						id="ledgerQueryClear"
						type="button"
						class="opacity-70 hover:opacity-100"
						title="Clear query (Esc)"
						aria-label="Clear query"
						on:click={() => ledgerStore.clearQuery()}
					>
						<X size={15} />
					</button>
				{/if}
				<button
					id="ledgerQueryFieldsToggle"
					type="button"
					class="btn btn-sm px-2 {queryFieldsOpen ? primary : 'opacity-70 hover:opacity-100'}"
					title="Query fields"
					aria-label="Query fields"
					aria-expanded={queryFieldsOpen}
					aria-controls="ledgerQueryFields"
					on:click={() => (queryFieldsOpen = !queryFieldsOpen)}
				>
					<CircleHelp size={15} />
				</button>
			</div>
			{#if $inLiveView}
				<span
					id="ledgerLive"
					class="flex items-center gap-1.5 px-3 text-sm"
					title="The live view: every pair, newest first"
					><span class="h-2 w-2 rounded-full bg-success-500"></span>Live</span
				>
			{:else}
				<button
					id="ledgerLive"
					type="button"
					class="flex items-center gap-1.5 px-3 text-sm hover:bg-surface-200-700-token"
					title="Back to the live view: clears the query and the sort"
					on:click={() => ledgerStore.backToLive()}
					><span class="h-2 w-2 rounded-full bg-surface-400"></span>Live</button
				>
			{/if}
			<SavedQueriesMenu
				queryText={$queryText}
				valid={$queryActive && !$queryPending && !queryBoxError && $query.ranQuery === $queryText}
				on:apply={(e) => applyQuery(e.detail)}
			/>
			<ToolbarMenu
				id="ledgerHighlights"
				label="Highlights"
				icon={Highlighter}
				title="Pairs by highlight"
				badge={activeHighlights ? String(activeHighlights) : ""}
				panelClass="w-72"
				on:open={highlightCounts.load}
			>
				<HighlightsMenu
					queryText={$queryText}
					counts={$highlightCounts}
					palette={$highlightPalette}
					on:toggle={(e) => ledgerStore.toggleQueryTerm(e.detail)}
					on:rename={(e) => onRenameHighlight(e.detail)}
				/>
			</ToolbarMenu>
			<ToolbarMenu
				id="ledgerMarks"
				label="Marks"
				icon={Tags}
				title="Pairs with a note or a link"
				badge={activeMarks ? String(activeMarks) : ""}
				panelClass="w-64"
				on:open={markCounts.load}
			>
				<MarksMenu
					queryText={$queryText}
					counts={$markCounts}
					on:toggle={(e) => ledgerStore.toggleQueryTerm(e.detail)}
				/>
			</ToolbarMenu>
			<LedgerTypesMenu bind:this={typesMenu} />
			{#if queryFieldsOpen}
				<div
					id="ledgerQueryFields"
					class="ledger-query-fields card absolute left-2 top-full z-40 mt-1 max-h-[50vh] w-[40rem] max-w-[90%] overflow-auto p-3 shadow-xl"
				>
					<QueryFieldList on:insert={(e) => insertQueryExample(e.detail)} />
				</div>
			{/if}
		</div>

		<!-- The table, and the drawer below it while a pair is selected. -->
		<div class="relative flex min-h-0 flex-1 flex-col" bind:this={tableArea}>
			{#if !(drawerOpen && $drawerLayout.maximised)}
				<div
					class="relative min-h-0"
					style="flex: {drawerOpen ? 1 - $drawerLayout.split : 1} 1 0"
				>
					<LedgerTable
						bind:this={table}
						drawerBelow={drawerOpen}
						rows={$rows}
						focusId={focusID}
						selectedIds={$selection.ids}
						palette={$highlightPalette}
						sort={$sort}
						pinTop={$newKind === "top" && !$results.hasBefore}
						resetKey={$results.reset}
						ghost={ghostRows}
						on:click={(e) => ledgerStore.clickRow(e.detail.id, e.detail)}
						on:sweepstart={(e) => ledgerStore.startSweep(e.detail)}
						on:sweep={(e) => ledgerStore.sweepTo(e.detail)}
						on:sweepend={() => ledgerStore.endSweep()}
						on:step={(e) => ledgerStore.stepSelection(e.detail.step, { extend: e.detail.extend })}
						on:selectall={() => ledgerStore.selectAll()}
						on:menukey={openRowMenuAtFocus}
						on:viewport={(e) => {
							inView = e.detail;
							ledgerStore.setViewport(e.detail);
						}}
						on:sort={(e) => ledgerStore.sortBy(e.detail)}
						on:menu={(e) => {
							const target = rowMenuTarget(get(ledgerStore), e.detail.id);
							openRowMenu(e.detail.event.clientX, e.detail.event.clientY, target);
						}}
					/>
				</div>
			{/if}
			{#if drawerOpen}
				{#if !$drawerLayout.maximised}
					<!-- The handle takes no room: it draws over the border, so the
					     drawer's content sits flush against it. -->
					<div class="relative h-0 flex-none">
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<div
							class="ledger-drawer-resize absolute inset-x-0 -top-1 z-30 h-2 cursor-row-resize hover:bg-primary-500/50"
							title="Drag to resize the drawer"
							on:pointerdown={startDrawerResize}
						></div>
					</div>
				{/if}
				<!-- The red top line is drawn over the drawer, in the drawer's own
				     stacking context, rather than as a border: CodeMirror's sticky
				     gutters are composited layers (z-index 200) that WebKit's elastic
				     scrolling could paint over a border, and a border also made the
				     page a pixel taller than its box. -->
				<div
					class="relative isolate min-h-0"
					style="flex: {$drawerLayout.maximised ? 1 : $drawerLayout.split} 1 0"
				>
					{#if !$drawerLayout.maximised}
						<div
							class="ledger-drawer-edge pointer-events-none absolute inset-x-0 top-0 z-[300] h-px bg-primary-500"
							aria-hidden="true"
						></div>
					{/if}
					<LedgerDrawer
						store={ledgerStore}
						pair={$focused}
						number={focusNumber}
						incomingResponse={$selection.incomingResponse}
						maximised={$drawerLayout.maximised}
						expanded={$drawerLayout.expanded}
						bind:pane={drawerPane}
						highlight={rowHighlight($focused, $highlightPalette)}
						palette={$highlightPalette}
						findings={linkedTo($focused.ID, $findingStore)}
						testCases={linkedTo($focused.ID, $testCaseStore)}
						canOpenStream={canOpenDrawerStream($drawerKeys.meta)}
						on:step={(e) => ledgerStore.stepSelection(e.detail)}
						on:maximise={() => ledgerStore.toggleDrawerMaximised()}
						on:close={closeDrawer}
						on:expand={(e) => ledgerStore.setDrawerExpanded(e.detail)}
						on:action={(e) => drawerHandlers.get(e.detail)?.()}
						on:highlight={(e) => highlightFocused(e.detail)}
					/>
				</div>
			{/if}
			{#if $newLabel && !(drawerOpen && $drawerLayout.maximised)}
				<div class="pointer-events-none absolute left-0 right-0 top-8 z-20 flex justify-center">
					<!-- The page colour behind the button keeps light mode's see-through
					     primary variant readable over the rows. A flex box, so it is
					     exactly the button's size (a block took the 24px line height). -->
					<div class="pointer-events-auto flex bg-surface-50 shadow-lg dark:bg-surface-900">
						{#if $newKind === "top"}
							<button
								id="ledgerNewMatches"
								type="button"
								class="btn btn-sm rounded-none py-0.5 text-xs {primary}"
								title="Back to the top"
								on:click={showNewAtTop}
							>
								{$newLabel}
							</button>
						{:else}
							<button
								id="ledgerNewMatches"
								type="button"
								class="btn btn-sm rounded-none py-0.5 text-xs {primary}"
								title="Show them, keeping your place"
								on:click={() => ledgerStore.showNewMatches()}
							>
								{$newLabel} · Show
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Status bar. It clips: its 24px text lines sat 0.5px past its 23px
		     inside, which made the page scrollable by a pixel (opening the note
		     pane scrolled it). -->
		<div
			class="ledger-status flex h-6 flex-none items-center gap-4 overflow-hidden border-t border-surface-300-600-token bg-surface-100 px-3 text-[11px] tabular-nums dark:bg-surface-800"
		>
			<span id="ledgerCount" class="opacity-80"
				>{#if ghostRows}Querying Marasi…{:else}{$statusCount}{#if position}<span id="ledgerPosition" class="opacity-70"
							>{` · ${position}`}</span
						>{/if}{/if}</span
			>
			{#if $hiddenCount}
				<span class="opacity-60">{$hiddenCount.toLocaleString()} hidden by type</span>
			{/if}
			{#if drawerOpen}
				<span id="ledgerSelectionCount" class="text-primary-500">
					{#if $allLabel}
						{$allLabel}
					{:else if selectedCount === 1}
						Request {focusNumber} selected
					{:else}
						{selectedCount.toLocaleString()} selected
					{/if}
				</span>
				<button
					id="ledgerClearSelection"
					class="-ml-3 flex h-4 w-4 items-center justify-center opacity-60 hover:bg-surface-200-700-token hover:opacity-100"
					title="Clear the selection and close the drawer (Esc)"
					aria-label="Clear the selection"
					on:click={closeDrawer}><X size={11} /></button
				>
			{/if}
		</div>
	</div>
</div>

<RowMenu
	bind:open={rowMenu.open}
	x={rowMenu.x}
	y={rowMenu.y}
	pairs={rowMenu.pairs}
	context={rowMenuContext}
	on:action={(e) => runMenuAction(e.detail, rowMenu.target)}
	on:close={(e) => e.detail.refocus && table?.focus()}
/>

