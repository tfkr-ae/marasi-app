<script>
	// The Ledger's row menu: where it opens and what it acts on, its context (launchpads, findings, test cases, palette), and the shortcuts that run its items.
	import { get } from "svelte/store";
	import { getModalStore, getToastStore } from "@skeletonlabs/skeleton";
	import RowMenu from "./RowMenu.svelte";
	import { menuAction, menuFor } from "./rowMenu.js";
	import { select } from "../storeSelect.js";
	import { launchpadStore } from "../../stores/launchpadStore";
	import { highlightPalette } from "../../stores/highlightsStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { findingStore } from "../../stores/findingStore";
	import { ledgerStore, selectionSize, selectionTarget as storeSelectionTarget } from "../../stores/ledgerStore";

	// The table (LedgerTable) and the area that holds it, to place the menu.
	export let table;
	export let tableArea;
	// The page's drawer state and focused pair.
	export let drawerOpen = false;
	export let focusID = null;
	// Runs a chosen item's action on its target (ledgerActions.js).
	export let runMenuAction;

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	// How many pairs are selected; a ⌘A selection's count arrives after.
	const liveSize = select(ledgerStore, selectionSize);

	// What an action runs on (selectionTarget in the store).
	const selectionTarget = () => storeSelectionTarget(get(ledgerStore));

	// The row menu: whether it shows, where, and the pairs it acts on, taken
	// from the selection when it opens.
	// `target` is what the menu's actions run on (see selectionTarget).
	let rowMenu = { open: false, x: 0, y: 0, pairs: [], target: null };

	// Opens the row menu at a point, on the selection or `target`.
	export function openRowMenu(x, y, target = selectionTarget()) {
		if (target.pairs.length === 0) return;
		rowMenu = { open: true, x, y, pairs: target.pairs, target };
	}

	// Opens the row menu under the focused row, as ⌘⇧. and the menu key do.
	export function openRowMenuAtFocus() {
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
	export function runShortcut(actionId) {
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
</script>

<RowMenu
	bind:open={rowMenu.open}
	x={rowMenu.x}
	y={rowMenu.y}
	pairs={rowMenu.pairs}
	context={rowMenuContext}
	on:action={(e) => runMenuAction(e.detail, rowMenu.target)}
	on:close={(e) => e.detail.refocus && table?.focus()}
/>
