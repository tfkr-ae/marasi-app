<script context="module">
	// Survives page visits so the grouping choice sticks while iterating.
	let savedGroupByStatus = false;
</script>

<script>
	// The Launchpad file tree: one scroll container, sticky launchpad rows,
	// each list in entry order, windowed to its last entries.
	// Row building lives in treeRows.js; this component only renders.
	import { modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { afterUpdate, onDestroy, tick } from "svelte";
	import { ArrowDown, Ban, ChevronDown, CircleAlert, LoaderCircle, ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, Plus, Search } from "lucide-svelte";
	import { isDraftDirty, isEntrySelected, launchOf, newestEntryOf, pendingEntryIds, pendingLaunchOf, selectedEntryIds } from "../../stores/launchpadStore";
	import { entryRows, launchpadSummary, searchLaunchpads, STEP, WINDOW } from "./treeRows.js";
	import { dropTarget, moveRefusal } from "./entryMove.js";
	import { jumpTarget } from "./jumpTarget.js";
	import { autoExpand, collapseAll, expandAll, revealEntry } from "./treeExpansion.js";
	import { COMPARE_SIDES, compareSideOf } from "./compare.js";
	import { entryLengthText, launchEndText, primaryVariant, shortTime, statusClass } from "./format.js";

	export let store;
	export let pickLaunchpad;
	export let pickEntry;
	// The page's Move ({ sourceId, targetId, ids, before }): the store's
	// moveEntries plus its toasts. Resolves to { moved, refused }.
	export let moveEntries;
	// Opens the entry context menu at (x, y) for the Entry selection.
	export let openEntryMenu = () => {};
	// Opens the launchpad context menu at (x, y) for launchpad `id`.
	export let openLaunchpadMenu = () => {};
	// The launchpad the launchpad menu is open for, whose row is outlined;
	// null while it is shut.
	export let menuLaunchpadId = null;
	export let searchInput = null;

	export let groupByStatus = savedGroupByStatus;
	$: savedGroupByStatus = groupByStatus;

	let expanded = {};
	let shownByList = {};
	let openGroups = {};
	let creating = false;
	let newName = "";
	let newNameInput;

	$: primary = primaryVariant($modeCurrent);
	$: state = $store;
	$: results = searchLaunchpads(state);
	$: searching = state.search.trim().length > 0;
	$: selectedLaunchpadId = state.selectedLaunchpadId;
	$: compare = state.compare;
	$: entrySearch = state.entrySearch;
	// Entry lists load when a launchpad opens (expanded, Expand all, or
	// listed by a search); the tree's counts come from Marasi's summary.
	let requested = new Set();
	let requestedVersion = null;
	$: {
		if (requestedVersion !== state.projectStateVersion) {
			requested = new Set();
			requestedVersion = state.projectStateVersion;
		}
		for (const { launchpad } of results) {
			const id = launchpad.ID;
			if (!(searching || expanded[id]) || state.entriesByLaunchpad[id] !== undefined || requested.has(id)) continue;
			requested.add(id);
			store.loadEntries(id);
		}
	}
	$: {
		const next = autoExpand(expanded, selectedLaunchpadId);
		if (next !== expanded) expanded = next;
	}
	function setAll(result) {
		expanded = result.expanded;
		openGroups = result.openGroups;
	}
	// An entry's live launch outcome, or its stored one; decides its status folder.
	$: launchFor = (entry) => launchOf(state, entry.ID, entry);
	const openAll = () => setAll(expandAll({ ...state, groupByStatus, openGroups, launchFor }));
	const closeAll = () => setAll(collapseAll({ ...state, launchFor }));

	export function startCreate() {
		creating = true;
		newName = "";
		queueMicrotask(() => newNameInput?.focus());
	}
	async function finishCreate() {
		const name = newName.trim();
		if (!creating) return;
		creating = false;
		newName = "";
		if (name) await store.createLaunchpad({ name });
	}

	function reveal(node, active) {
		const run = (on) => on && node.scrollIntoView({ block: "nearest" });
		run(active);
		return { update: run };
	}
	const showMore = (list) =>
		(shownByList = { ...shownByList, [list]: (shownByList[list] ?? WINDOW) + STEP });
	const showAll = (list, total) => (shownByList = { ...shownByList, [list]: total });
	const rowKey = (row) =>
		row.kind === "entry" ? row.entry.ID : row.kind === "group" ? row.id : `more:${row.list}`;

	// Entry selection: a plain click selects one entry and seeds the draft
	// (the page's pickEntry), ⌘/Ctrl toggles and ⇧ selects a range. Grouped
	// or searching, a range covers only the rows shown. The click focuses the
	// tree, where ⌘A and Esc work: WebKit does not focus a clicked button.
	function clickEntry(event, launchpadId, entryId, rows) {
		if (suppressClick) return;
		scroller?.focus({ preventScroll: true });
		if (event.metaKey || event.ctrlKey) return store.toggleEntry(launchpadId, entryId);
		if (event.shiftKey) {
			const shown = groupByStatus || searching ? rows.filter((row) => row.kind === "entry").map((row) => row.entry.ID) : null;
			return store.extendEntrySelection(launchpadId, entryId, shown);
		}
		pickEntry(launchpadId, entryId);
	}
	// A right-click acts on the Entry selection; outside it, the entry
	// becomes the selection. The draft is not reseeded.
	function rightClickEntry(event, launchpadId, entryId) {
		scroller?.focus({ preventScroll: true });
		if (!isEntrySelected(state, launchpadId, entryId)) store.selectOnlyEntry(launchpadId, entryId);
		openEntryMenu(event.clientX, event.clientY);
	}
	// A right-click on a launchpad row selects nothing.
	function rightClickLaunchpad(event, launchpadId) {
		scroller?.focus({ preventScroll: true });
		openLaunchpadMenu(launchpadId, event.clientX, event.clientY);
	}
	/** Focuses the tree, where its shortcuts work. */
	export function focus() {
		scroller?.focus({ preventScroll: true });
	}
	// Esc is the page's key (gate.js), so the tree collapses the selection
	// itself; with one entry selected, Esc goes on to the page (closing compare).
	function onTreeKeydown(event) {
		if (event.key !== "Escape" || event.defaultPrevented || state.entrySelection.ids.length < 2) return;
		event.preventDefault();
		store.collapseEntrySelection();
	}

	// Drag and drop (spec: Drag and drop). Pointer events, not HTML5 drag and
	// drop, which Wails owns for file drops. A press becomes a drag after
	// DRAG_START px, so a plain click still selects. Where a drop lands and
	// why it is refused come from entryMove.js; the pill shows the reason.
	const DRAG_START = 5;
	const EDGE = 36;
	const SCROLL_STEP = 8;
	const HOVER_EXPAND_MS = 600;
	// { from, entryId, startX, startY, x, y, active, ids, target, refused }
	let drag = null;
	let suppressClick = false;
	let scrollFrame = null;
	let hoverTimer = null;
	let hoverLaunchpad = null;

	function pressEntry(event, launchpadId, entryId) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
		drag = { from: launchpadId, entryId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, ids: [], target: null, refused: null };
	}

	// Dragging a selected entry drags the whole Entry selection in entry
	// order; an unselected one drags alone and becomes the selection.
	function startDrag() {
		const selected = isEntrySelected(state, drag.from, drag.entryId);
		if (!selected) store.selectOnlyEntry(drag.from, drag.entryId);
		drag = { ...drag, active: true, ids: selected ? selectedEntryIds(state) : [drag.entryId] };
		scrollFrame = requestAnimationFrame(autoScroll);
	}

	const entryIds = (launchpadId) => (state.entriesByLaunchpad[launchpadId] || []).map((entry) => entry.ID);

	// The row under the pointer, as dropTarget reads it.
	function hitAt(x, y) {
		const node = document.elementFromPoint(x, y)?.closest("[data-drop]");
		if (!node || !scroller?.contains(node)) return null;
		const launchpadId = node.dataset.dropLaunchpad;
		if (node.dataset.drop === "launchpad") return { kind: "launchpad", launchpadId };
		const rect = node.getBoundingClientRect();
		return { kind: "entry", launchpadId, entryId: node.dataset.entry, top: rect.top, height: rect.height };
	}

	// Re-reads the target under the pointer; also run while auto-scrolling.
	function aim() {
		const hit = hitAt(drag.x, drag.y);
		hoverToExpand(hit?.kind === "launchpad" && !expanded[hit.launchpadId] && !searching ? hit.launchpadId : null);
		const target = hit && dropTarget({ hit, pointerY: drag.y, order: entryIds(hit.launchpadId), moving: drag.ids });
		const refused =
			target &&
			moveRefusal({
				sourceId: drag.from,
				ids: drag.ids,
				target,
				targetName: state.launchpads.find((launchpad) => launchpad.ID === target.launchpadId)?.Name ?? "",
				targetIds: state.entriesByLaunchpad[target.launchpadId] ? entryIds(target.launchpadId) : null,
				pendingIds: pendingEntryIds(state, drag.from, drag.ids),
				grouped: groupByStatus,
				searching,
			});
		drag = { ...drag, target, refused };
	}

	// Hovering a collapsed launchpad's row opens it after a moment.
	function hoverToExpand(launchpadId) {
		if (launchpadId === hoverLaunchpad) return;
		clearTimeout(hoverTimer);
		hoverLaunchpad = launchpadId;
		if (launchpadId) hoverTimer = setTimeout(() => (expanded = { ...expanded, [launchpadId]: true }), HOVER_EXPAND_MS);
	}

	function autoScroll() {
		if (!drag?.active) return;
		const box = scroller.getBoundingClientRect();
		const step = drag.y < box.top + EDGE ? -SCROLL_STEP : drag.y > box.bottom - EDGE ? SCROLL_STEP : 0;
		if (step) {
			scroller.scrollTop += step;
			aim();
		}
		scrollFrame = requestAnimationFrame(autoScroll);
	}

	function onPointerMove(event) {
		if (!drag) return;
		drag.x = event.clientX;
		drag.y = event.clientY;
		if (!drag.active) {
			if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < DRAG_START) return;
			startDrag();
		}
		aim();
	}

	async function onPointerUp() {
		if (!drag) return;
		const { active, from, ids, target, refused } = drag;
		endDrag();
		if (!active) return;
		// The click that ends a drag is not a selection click.
		suppressClick = true;
		setTimeout(() => (suppressClick = false));
		if (!target || refused) return;
		const { moved } = await moveEntries({ sourceId: from, targetId: target.launchpadId, ids, before: target.before });
		if (moved?.length) await showMoved(target.launchpadId, moved);
	}

	function endDrag() {
		drag = null;
		cancelAnimationFrame(scrollFrame);
		hoverToExpand(null);
	}

	function onDragKeydown(event) {
		if (event.key !== "Escape" || !drag?.active) return;
		event.preventDefault();
		event.stopPropagation();
		endDrag();
	}
	onDestroy(() => {
		endDrag();
		if (typeof document !== "undefined") delete document.body.dataset.launchpadDrag;
	});

	// After a move: the target opens, its window widens to the moved entries,
	// and the first scrolls into view.
	async function showMoved(launchpadId, moved) {
		const entries = state.entriesByLaunchpad[launchpadId] || [];
		const first = entries.findIndex((entry) => entry.ID === moved[0]);
		if (first >= 0 && !groupByStatus) {
			const shown = Math.max(shownByList[launchpadId] ?? WINDOW, entries.length - first);
			shownByList = { ...shownByList, [launchpadId]: shown };
		}
		await showEntry(launchpadId, moved[0]);
	}

	$: dragging = drag?.active ? new Set(drag.ids) : new Set();
	// Where to draw the insertion line: { entryId, edge }, or the tinted row.
	$: dropLine = drag?.active && !drag.refused && drag.target?.via === "entry" ? drag.target.line : null;
	$: dropLaunchpad = drag?.active && drag.target?.via === "launchpad" ? drag.target.launchpadId : null;
	$: if (typeof document !== "undefined") {
		document.body.dataset.launchpadDrag = drag?.active ? (drag.refused ? "refused" : "move") : "";
	}

	// Floating "End of …": measured after every render and on scroll.
	// Synchronous on purpose: scroll events already arrive once per frame,
	// and requestAnimationFrame never fires while the window is hidden.
	let scroller;
	let jump = null;
	function updateJump() {
		if (!scroller) return;
		const box = scroller.getBoundingClientRect();
		// Every row except open (sticky) launchpad headers; rows outside a
		// list carry no data-list.
		const rows = [...scroller.querySelectorAll("[data-tree-row]")].map((node) => {
			const rect = node.getBoundingClientRect();
			return {
				list: node.dataset.list ?? null,
				label: node.dataset.label,
				last: node.dataset.last === "true",
				top: rect.top,
				bottom: rect.bottom,
			};
		});
		const next = jumpTarget(rows, { top: box.top, bottom: box.bottom });
		// Only assign on change; afterUpdate would otherwise loop.
		if (next?.list !== jump?.list || next?.label !== jump?.label) jump = next;
	}
	afterUpdate(updateJump);
	// Opens the rows holding an entry and scrolls it into view (⌘⇧↓).
	export async function showEntry(launchpadId, entryId) {
		setAll(revealEntry({ expanded, openGroups, entriesByLaunchpad: state.entriesByLaunchpad, groupByStatus, launchFor }, launchpadId, entryId));
		await tick();
		scroller?.querySelector(`[data-entry="${CSS.escape(entryId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}
	// The floating button only scrolls; it never changes the selection.
	export function jumpToEnd() {
		if (!jump) return;
		const last = scroller.querySelector(`[data-list="${CSS.escape(jump.list)}"][data-last="true"]`);
		last?.scrollIntoView({ block: "end", behavior: "smooth" });
	}
</script>

<svelte:window on:pointermove={onPointerMove} on:pointerup={onPointerUp} on:pointercancel={endDrag} on:keydown|capture={onDragKeydown} />

<div class="flex h-full min-h-0 flex-col">
	<header class="space-y-2 border-b border-surface-500/30 p-3">
		<div class="flex items-center justify-between">
			<h2 class="font-bold">
				Launchpads <span class="text-xs font-normal opacity-50">{state.launchpads.length}</span>
			</h2>
			<div class="flex gap-1">
				<button class="lp-expand-all btn btn-sm variant-soft px-2" aria-label="Expand all" title="Expand all" on:click={openAll}>
					<ChevronsUpDown size={16} />
				</button>
				<button
					class="lp-collapse-all btn btn-sm variant-soft px-2"
					aria-label="Collapse all"
					title="Collapse all"
					on:click={closeAll}
				>
					<ChevronsDownUp size={16} />
				</button>
				<button class="btn btn-sm {primary} px-2" aria-label="New launchpad" title="New launchpad" on:click={startCreate}>
					<Plus size={16} />
				</button>
			</div>
		</div>
		<div class="input-group input-group-divider grid-cols-[auto_1fr]">
			<div class="input-group-shim"><Search size={14} /></div>
			<input
				bind:this={searchInput}
				type="search"
				class="text-sm"
				placeholder="Search launchpads and entries…"
				aria-label="Search launchpads"
				value={state.search}
				on:input={(e) => store.setSearch(e.currentTarget.value)}
				on:keydown={(e) => e.key === "Escape" && store.setSearch("")}
			/>
		</div>
		{#if searching && entrySearch.status === "error"}
			<p class="lp-search-error text-xs text-error-500" role="alert">{entrySearch.error}</p>
		{:else if searching && entrySearch.status === "loading"}
			<p class="lp-search-status text-xs opacity-60">Searching entries…</p>
		{:else if searching && entrySearch.status === "idle"}
			<p class="lp-search-status text-xs opacity-60">Type 3 or more characters to search entries.</p>
		{/if}
		<div class="flex items-center justify-between">
			<span class="text-sm font-bold">Group by status</span>
			<SlideToggle name="Group by status" size="sm" bind:checked={groupByStatus} />
		</div>
		{#if creating}
			<input
				bind:this={newNameInput}
				class="input h-8 text-sm"
				placeholder="New launchpad name, Enter to create"
				aria-label="New launchpad name"
				bind:value={newName}
				on:keydown={(e) => {
					if (e.key === "Enter") finishCreate();
					if (e.key === "Escape") creating = false;
				}}
				on:blur={(e) => {
					// The Marasi menu (⌘K) borrows focus and hands it back on close.
					if (!e.relatedTarget?.closest?.("dialog")) finishCreate();
				}}
			/>
		{/if}
	</header>

	<div class="relative min-h-0 flex-1">
		<!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-no-static-element-interactions -->
		<div
			class="lp-scroll h-full overflow-y-auto pb-12 focus:outline-none"
			data-launchpad-tree
			tabindex="-1"
			bind:this={scroller}
			on:scroll={updateJump}
			on:keydown={onTreeKeydown}
		>
			{#if results.length === 0 && !(searching && entrySearch.status === "loading")}
				<p class="p-4 text-center text-sm opacity-60">
					{searching ? "No matching launchpads or entries" : "No launchpads yet"}
				</p>
			{/if}
			{#each results as { launchpad, entries, matchedEntries, matchCount } (launchpad.ID)}
				{@const isSelected = launchpad.ID === selectedLaunchpadId}
				{@const open = searching || expanded[launchpad.ID]}
				{@const unseen = state.unseenByLaunchpad[launchpad.ID] || 0}
				{@const summary = launchpadSummary(launchpad)}
				{@const newest = newestEntryOf(state, launchpad.ID)}
				{@const newestLaunch = newest ? launchOf(state, newest.ID, newest) : null}
				{@const awaiting = Boolean(pendingLaunchOf(state, launchpad.ID)) || newestLaunch?.Status === "pending"}
				{@const selectedEntryId = state.selectedEntryByLaunchpad[launchpad.ID]}
				{@const rows = open
					? entryRows({ launchpad, entries, matchedEntries, groupByStatus, shownByList, openGroups, selectedEntryId, launchFor })
					: []}
				{@const dropHere = dropLaunchpad === launchpad.ID}
				<div data-launchpad={launchpad.ID}>
					<div
						data-tree-row={open ? undefined : ""}
						data-drop="launchpad"
						data-drop-launchpad={launchpad.ID}
						class="lp-row flex items-center gap-1.5 border-l-4 pr-3 text-sm {open ? 'sticky top-0 z-10' : ''} {isSelected
							? 'border-primary-500 bg-surface-200 dark:bg-surface-700'
							: 'border-transparent bg-surface-50 hover:bg-surface-100 dark:bg-surface-900 dark:hover:bg-surface-800'} {dropHere
							? drag.refused
								? 'outline outline-2 -outline-offset-2 outline-error-500'
								: 'lp-drop-row'
							: menuLaunchpadId === launchpad.ID
								? 'outline outline-2 -outline-offset-2 outline-primary-500'
								: ''}"
						on:contextmenu|preventDefault={(event) => rightClickLaunchpad(event, launchpad.ID)}
					>
						<button
							class="py-1.5 pl-1.5 opacity-60 hover:opacity-100"
							aria-label={`${open ? "Collapse" : "Expand"} ${launchpad.Name}`}
							aria-expanded={!!open}
							on:click={() => (expanded = { ...expanded, [launchpad.ID]: !open })}
						>
							{#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
						</button>
						<button
							class="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
							aria-current={isSelected ? "true" : undefined}
							on:click={() => pickLaunchpad(launchpad.ID)}
						>
							{#if open}
								<FolderOpen size={14} class="flex-none text-primary-500" />
							{:else}
								<Folder size={14} class="flex-none opacity-60" />
							{/if}
							<span class="truncate {isSelected ? 'font-bold' : ''}" title={launchpad.Description || launchpad.Name}
								>{launchpad.Name}</span
							>
							{#if isDraftDirty(state, launchpad.ID)}
								<span class="h-1.5 w-1.5 flex-none rounded-full bg-warning-500" title="Unsaved draft"></span>
							{/if}
							{#if pendingLaunchOf(state, launchpad.ID)}
								<span class="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-primary-500" title="Launching"></span>
							{/if}
						</button>
						{#if unseen}
							<span class="badge {primary} px-1.5 py-0 text-[10px]" title="{unseen} new {unseen === 1 ? 'entry' : 'entries'}"
								>+{unseen}</span
							>
						{/if}
						<span class="flex-none text-[10px] opacity-50" title="Entries">{summary.count || ""}</span>
						{#if summary.lastStatus}
							<span
								class="w-7 flex-none text-right font-mono text-[10px] {statusClass(summary.lastStatus)}"
								title="Last status">{summary.lastStatus}</span
							>
						{:else if summary.lastStatus === 0}
							<!-- No response code: in flight, or how the newest launch ended. -->
							<span class="flex w-7 flex-none justify-end text-[10px] opacity-60" title="Last status">
								{#if awaiting}
									<LoaderCircle size={11} class="animate-spin" />
								{:else if newestLaunch?.Status === "cancelled"}
									<Ban size={11} />
								{:else if newestLaunch?.Status === "failed"}
									<CircleAlert size={11} class="text-error-500" />
								{:else}
									—
								{/if}
							</span>
						{/if}
					</div>

					{#if open}
						{#if matchedEntries}
							<p data-tree-row class="lp-match-count py-1 pl-10 text-xs opacity-60">
								{matchCount} matching {matchCount === 1 ? "entry" : "entries"}
							</p>
						{/if}
						{#if state.entriesByLaunchpad[launchpad.ID] === undefined}
							<p data-tree-row class="py-1 pl-10 text-xs opacity-50">Loading…</p>
						{:else if entries.length === 0}
							<p data-tree-row class="py-1 pl-10 text-xs opacity-50">Empty launchpad</p>
						{/if}
						{#each rows as row (rowKey(row))}
							{#if row.kind === "more"}
								<!-- Same columns as an entry row: ⋯ under the numbers, text under the path. -->
								<div
									data-tree-row
									data-list={row.list}
									class="lp-more relative flex items-center gap-2 border-y border-dashed border-surface-500/30 py-[3px] pr-3 text-[11px] {row.depth === 2
										? 'pl-14'
										: 'pl-10'}"
								>
									<span class="absolute bottom-0 left-[1.15rem] top-0 border-l border-surface-500/30"></span>
									{#if row.depth === 2}<span class="absolute bottom-0 left-[2.4rem] top-0 border-l border-surface-500/30"></span>{/if}
									<span class="w-9 flex-none text-right font-mono opacity-50">⋯</span>
									<span class="min-w-0 flex-1 truncate opacity-60"
										>{row.hidden} earlier {row.hidden === 1 ? "entry" : "entries"}</span
									>
									<button class="flex-none text-primary-500 hover:underline" on:click={() => showMore(row.list)}>
										Show {Math.min(STEP, row.hidden)} more
									</button>
									{#if row.hidden > STEP}
										<button class="flex-none text-primary-500 hover:underline" on:click={() => showAll(row.list, row.total)}
											>Show all</button
										>
									{/if}
								</div>
							{:else if row.kind === "group"}
								<button
									data-tree-row
									data-list={row.open ? row.id : undefined}
									class="lp-group relative flex w-full items-center gap-1.5 py-1 pl-8 pr-3 text-left text-xs hover:bg-surface-100 dark:hover:bg-surface-800"
									aria-expanded={row.open}
									on:click={() => (openGroups = { ...openGroups, [row.id]: !row.open })}
								>
									<span class="absolute bottom-0 left-[1.15rem] top-0 border-l border-surface-500/30"></span>
									{#if row.open}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
									{#if row.open}<FolderOpen size={12} class="opacity-60" />{:else}<Folder size={12} class="opacity-60" />{/if}
									<span class="font-mono {row.key === 'pending' ? 'opacity-50' : statusClass(Number(row.key))}">{row.key}</span>
									<span class="ml-auto opacity-50">{row.count}</span>
								</button>
							{:else}
								{@const entry = row.entry}
								{@const inCompare = compare?.launchpadId === launchpad.ID}
								{@const active = isSelected && selectedEntryId === entry.ID && !inCompare}
								{@const picked = isEntrySelected(state, launchpad.ID, entry.ID)}
								{@const side = inCompare ? compareSideOf(compare, entry.ID) : null}
								{@const launch = launchOf(state, entry.ID, entry)}
								{@const endText = launchEndText(launch)}
								<button
									class="lp-entry group relative flex w-full select-none items-center gap-2 py-[3px] pr-3 text-left font-mono text-[11px] {row.depth ===
									2
										? 'pl-14'
										: 'pl-10'} {active
										? 'bg-primary-500/20'
										: picked
											? 'bg-primary-500/15'
											: inCompare && compare.picking
												? 'hover:bg-primary-500/15'
												: 'hover:bg-surface-100 dark:hover:bg-surface-800'} {dragging.has(entry.ID) ? 'opacity-35' : ''}"
									data-selected={picked ? "true" : undefined}
									data-drop="entry"
									data-drop-launchpad={launchpad.ID}
									data-compare={side ? COMPARE_SIDES[side].label : undefined}
									title="#{row.index + 1} · pair #{entry.Number} · {entry.Method} {entry.Host}{entry.Path} · {shortTime(entry.RequestedAt)}{endText
										? ` · ${endText}`
										: ''}"
									data-launch={launch?.Status}
									aria-current={active ? "true" : undefined}
									data-entry={entry.ID}
									data-tree-row
									data-list={row.list ?? undefined}
									data-last={row.last ? "true" : undefined}
									data-label={row.label}
									use:reveal={active}
									on:pointerdown={(event) => pressEntry(event, launchpad.ID, entry.ID)}
									on:click={(event) => clickEntry(event, launchpad.ID, entry.ID, rows)}
									on:contextmenu|preventDefault={(event) => rightClickEntry(event, launchpad.ID, entry.ID)}
								>
									{#if picked}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
									{#if dropLine?.entryId === entry.ID}
										<!-- The insertion line, with a dot where it starts. -->
										<span
											class="lp-drop-line pointer-events-none absolute left-8 right-2 z-10 h-[2px] bg-primary-500 {dropLine.edge === 'top'
												? '-top-[1px]'
												: '-bottom-[1px]'}"
										>
											<span
												class="absolute -left-1 -top-[3px] h-2 w-2 rounded-full border-2 border-primary-500 bg-surface-50 dark:bg-surface-900"
											></span>
										</span>
									{/if}
									<span class="absolute bottom-0 left-[1.15rem] top-0 border-l border-surface-500/30"></span>
									{#if row.depth === 2}<span class="absolute bottom-0 left-[2.4rem] top-0 border-l border-surface-500/30"></span>{/if}
									<span class="flex w-9 flex-none items-center justify-end gap-1 opacity-60">
										{row.index + 1}
									</span>
									<span class="w-11 flex-none opacity-60">{entry.Method}</span>
									<span class="min-w-0 flex-1 truncate">{entry.Path}</span>
									{#if side}
										<span class="{side === 'left' ? 'variant-filled-tertiary' : primary} flex-none px-1.5 text-[10px] font-bold"
											>{COMPARE_SIDES[side].label}</span
										>
									{/if}
									{#if inCompare && compare.picking && !side}
										<span class="hidden flex-none text-[10px] text-primary-500 group-hover:inline">
											as {COMPARE_SIDES[compare.picking].label}
										</span>
									{/if}
									{#if launch?.Status === "pending"}
										<span class="flex w-7 flex-none justify-end opacity-60" title="Launching">
											<LoaderCircle size={12} class="animate-spin" />
										</span>
									{:else if launch?.Status === "cancelled"}
										<span class="flex w-7 flex-none justify-end opacity-60" title={endText}>
											<Ban size={12} />
										</span>
									{:else if launch?.Status === "failed"}
										<span class="flex w-7 flex-none justify-end text-error-500" title={endText}>
											<CircleAlert size={12} />
										</span>
									{:else}
										<span class="w-7 flex-none text-right {statusClass(entry.StatusCode)}">{entry.StatusCode || "…"}</span>
									{/if}
									<span class="w-9 flex-none text-right opacity-50">{entryLengthText(entry)}</span>
								</button>
							{/if}
						{/each}
					{/if}
				</div>
			{/each}
		</div>
		{#if jump}
			<!-- Opaque backing: the light-mode ghost variant is translucent. -->
			<div class="absolute bottom-3 left-1/2 z-20 max-w-[90%] -translate-x-1/2 bg-surface-50 shadow-lg dark:bg-surface-900">
				<button class="btn btn-sm {primary} w-full" title="Jump to the end of {jump.label}" on:click={jumpToEnd}>
					<ArrowDown size={14} />
					<span class="truncate">End of {jump.label}</span>
				</button>
			</div>
		{/if}
	</div>
</div>

{#if drag?.active}
	<!-- The pill: how many entries move, and why a drop here is refused. -->
	<div
		class="lp-drag-pill pointer-events-none fixed z-50 flex items-center gap-1.5 border px-2 py-1 text-xs shadow-xl bg-surface-100-800-token {drag.refused
			? 'border-error-500 text-error-500'
			: 'border-primary-500'}"
		style="left: {drag.x + 14}px; top: {drag.y + 10}px"
	>
		{#if drag.refused}<Ban size={12} />{/if}
		<span class="font-bold">{drag.ids.length} {drag.ids.length === 1 ? "entry" : "entries"}</span>
		{#if drag.refused}<span>· {drag.refused}</span>{/if}
	</div>
{/if}

<style>
	/* While dragging, the drag's cursor shows wherever the pointer goes. */
	:global(body[data-launchpad-drag="move"] *) {
		cursor: grabbing !important;
	}
	:global(body[data-launchpad-drag="refused"] *) {
		cursor: not-allowed !important;
	}
	/* A launchpad row taking a drop is tinted over its own background. */
	.lp-drop-row {
		background-color: rgb(var(--color-primary-500) / 0.25) !important;
	}
</style>
