<script>
	// The Ledger: the sitemap dock (full height), then a one-row toolbar, the
	// windowed table, the drawer below it while a pair is selected, and the
	// status bar. Its state lives in the Ledger store, so the layout and the
	// selection survive page visits.
	// The toolbar is LedgerToolbar.svelte, the row menu LedgerRowMenu.svelte,
	// the row menu's actions ledgerActions.js and the ⌘K menus ledgerMenus.js.
	import { onDestroy, tick } from "svelte";
	import { get } from "svelte/store";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { X } from "lucide-svelte";
	import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import { canOpenDrawerStream } from "../../lib/websocket/presentation.js";
	import Dock from "../../lib/dock/Dock.svelte";
	import { LEDGER_DOCK } from "../../lib/dock/dock.js";
	import LedgerToolbar from "../../lib/ledger/LedgerToolbar.svelte";
	import LedgerTable from "../../lib/ledger/LedgerTable.svelte";
	import LedgerSitemap from "../../lib/ledger/LedgerSitemap.svelte";
	import { activeSitemapNode, chooseSitemapNode, excludeSitemapNode, stripLabel } from "../../lib/ledger/sitemap.js";
	import { sitemapStore } from "../../stores/sitemapStore";
	import LedgerDrawer from "../../lib/ledger/LedgerDrawer.svelte";
	import { linkedTo } from "../../lib/ledger/drawer.js";
	import LedgerRowMenu from "../../lib/ledger/LedgerRowMenu.svelte";
	import { createLedgerActions } from "../../lib/ledger/ledgerActions.js";
	import { createLedgerMenus } from "../../lib/ledger/ledgerMenus.js";
	import { sameID } from "../../lib/ledger/pairs.js";
	import { select } from "../../lib/storeSelect.js";
	import { positionLabel, rowHighlight } from "../../lib/ledger/table.js";
	import { primaryVariant } from "../../lib/launchpad/format.js";
	import { highlightPalette } from "../../stores/highlightsStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { findingStore } from "../../stores/findingStore";
	import { mobile } from "../../lib/platform.js";
	import {
		ledgerStore,
		tableRows,
		hiddenByTypeCount,
		focusedPair,
		drawerKeybindingState,
		countLabel,
		newMatchesKind,
		newMatchesLabel,
		allSelectedLabel,
		rowMenuTarget,
	} from "../../stores/ledgerStore";

	// The parts of the Ledger store the page follows. Each notifies only when
	// its own value changes.
	const rows = select(ledgerStore, tableRows);
	const hiddenCount = select(ledgerStore, hiddenByTypeCount);
	const queryText = select(ledgerStore, (state) => state.queryText);
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
	const selection = select(ledgerStore, (state) => state.selection);
	const focused = select(ledgerStore, focusedPair);
	const drawerLayout = select(ledgerStore, (state) => state.layout.drawer);
	const drawerKeys = select(ledgerStore, drawerKeybindingState);
	const results = select(ledgerStore, (state) => state.results);
	const sort = select(ledgerStore, (state) => state.sort);
	const statusCount = select(ledgerStore, countLabel);
	// The window rows in view, as the table reports them.
	let inView = { first: 0, last: 0 };
	$: position = positionLabel({ start: $results.start, ...inView, empty: $rows.length === 0 });
	const newKind = select(ledgerStore, newMatchesKind);
	const newLabel = select(ledgerStore, newMatchesLabel);

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	let dock;
	let sitemapFind;
	let table;
	let tableArea;
	let toolbar;
	// The row menu (LedgerRowMenu.svelte): it opens on the selection or a row.
	let rowMenu;

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

	const { runMenuAction, highlightPairs, openWebSocketStream } = createLedgerActions({
		toastStore,
		modalStore,
		isDrawerOpen: () => drawerOpen,
		showInDrawer,
	});

	const { ledgerMenu, drawerMenu, websocketDrawerMenuItem, drawerHandlers } = createLedgerMenus({
		modalStore,
		toastStore,
		table: () => table,
		dock: () => dock,
		sitemapFind: () => sitemapFind,
		toolbar: () => toolbar,
		isDrawerOpen: () => drawerOpen,
		selectAndReveal,
		runShortcut: (actionId) => rowMenu?.runShortcut(actionId),
		openRowMenuAtFocus: () => rowMenu?.openRowMenuAtFocus(),
		toggleDrawerPane,
		openWebSocketStream,
	});


	// Every Ledger action stays registered; the drawer-closed, drawer-open and
	// WebSocket-upgrade menu contexts decide which ones a key reaches.
	useMenuActions([...ledgerMenu, websocketDrawerMenuItem, ...drawerMenu]);
	// The menu lists the actions of the drawer's current state, grouped as
	// the catalog says, then the Marasi section.
	$: menuOptions = !$drawerKeys.open
		? ledgerMenu
		: canOpenDrawerStream($drawerKeys.meta)
			? [websocketDrawerMenuItem, ...drawerMenu]
			: drawerMenu;


	// Puts `text` in the query box and runs it at once, or returns to the
	// live view when it is blank: a sitemap choice (choosing a node narrows
	// to it, again removes it, the eye-off button leaves it out) or a saved
	// query the menu chose.
	function applyQuery(text) {
		if (!text.trim()) return ledgerStore.clearQuery();
		ledgerStore.setQueryText(text);
		ledgerStore.runQuery(text);
	}

</script>

<svelte:window on:keydown={onWindowKeydown} />
<MarasiMenu paletteTier="page" pageName="Ledger" pageEntries={menuOptions} />

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
		<LedgerToolbar bind:this={toolbar} {ghostRows} on:apply={(e) => applyQuery(e.detail)} />

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
						on:menukey={() => rowMenu.openRowMenuAtFocus()}
						on:viewport={(e) => {
							inView = e.detail;
							ledgerStore.setViewport(e.detail);
						}}
						on:sort={(e) => ledgerStore.sortBy(e.detail)}
						on:menu={(e) => {
							const target = rowMenuTarget(get(ledgerStore), e.detail.id);
							rowMenu.openRowMenu(e.detail.event.clientX, e.detail.event.clientY, target);
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
				<!-- On mobile, maximised fills the screen (app.css, .mobile-fullscreen). -->
				<div
					class="relative isolate min-h-0"
					class:mobile-fullscreen={$mobile && $drawerLayout.maximised}
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
			class="ledger-status flex h-6 flex-none items-center gap-4 overflow-hidden border-t border-surface-300-600-token bg-surface-100 px-3 text-2xs tabular-nums dark:bg-surface-800"
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

<LedgerRowMenu
	bind:this={rowMenu}
	{table}
	{tableArea}
	{drawerOpen}
	{focusID}
	{runMenuAction}
/>
