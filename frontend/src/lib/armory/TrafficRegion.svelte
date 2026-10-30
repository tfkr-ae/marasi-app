<script>
	// The selected run's traffic in a table shaped like the Ledger's: a CSS
	// grid with a sticky header and 11px monospace rows. It is one scrolled
	// list that asks for the next page as it nears the end. Grouped, it is a
	// section per group, a header and the group's rows, each group asking for
	// its next page as its end nears. The rows, grouping, sort and open pair
	// are armoryStore's run traffic view (stores/createArmoryRunTraffic.js). Selected rows are tinted across the
	// full row, as in the Ledger; the open pair is framed. The page owns whether the panel is
	// open; the header toggles it.
	import { afterUpdate, onMount, tick } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import {
		ArrowDown,
		ArrowUp,
		ChevronDown,
		ChevronRight,
		ChevronsDownUp,
		ChevronsUpDown,
		ChevronUp,
	} from "lucide-svelte";
	import { METHOD_CLASS, primaryVariant, shortTime, statusClass } from "../launchpad/format.js";
	import { formatSize, statusText } from "../ledger/table.js";
	import { sameID } from "../ledger/pairs.js";
	import { TRAFFIC_COLUMNS, TRAFFIC_TEMPLATE, groupLabel, shareText } from "./traffic.js";

	/** The rows read so far, in the table's order; null when no run is selected. */
	export let requests = null;
	/** Whether pages past the last row are still to read (ungrouped). */
	export let hasMore = false;
	/** null, "status" or "length". */
	export let groupBy = null;
	/** The groups in order (runTrafficGroups), or null when not grouped. */
	export let groups = null;
	/** The run's pair count as Marasi counted it; null when not grouped. */
	export let total = null;
	/** Whether a column header sorts under the grouping. */
	export let isSortable = (column) => true;
	/** { column, desc }; column is null in # order. */
	export let sort = { column: null, desc: false };
	/** "n new" while sent pairs wait to be shown, else "". */
	export let newLabel = "";
	/** Where the list was scrolled, restored when the table mounts. */
	export let scrollTop = 0;
	/** Whether the table shows; the header toggles it. */
	export let open = true;
	/** The ID of the pair open in the drawer, framed in the table. */
	export let openId = null;
	/** The selected pairs' IDs, as strings. */
	export let selectedIds = new Set();
	/** "n selected" while a Selection exists, else "". */
	export let selectionLabel = "";
	/** A click on a row: plain, ⌘/Ctrl (`toggle`) or ⇧ (`range`). */
	export let onClick = (row, { toggle, range }) => {};
	export let onClearSelection = () => {};
	/** A right-click on a row: the page opens the row menu. */
	export let onMenu = (row, index, event) => {};
	export let onSort = (column) => {};
	/** Asks for the next page: of the list, or of the group with this value. */
	export let onLoadMore = (value) => {};
	export let onGroupBy = (groupBy) => {};
	/** A click on a group header: plain or ⌘/Ctrl (`toggle`). */
	export let onGroupClick = (group, { toggle }) => {};
	export let onExpandAll = () => {};
	export let onCollapseAll = () => {};
	export let onShowNew = () => {};
	export let onScroll = (scrollTop) => {};

	// How near the end, in pixels, the list asks for the next page.
	const LOAD_AHEAD = 400;
	let list;

	$: primary = primaryVariant($modeCurrent);

	const GROUPINGS = [
		{ key: null, label: "None" },
		{ key: "status", label: "Status" },
		{ key: "length", label: "Length" },
	];

	// What the list draws, top to bottom: a group's header, its rows while
	// open, and a "more" row where its unread pages start.
	$: items = groups
		? groups.flatMap((group) => [
				{ kind: "group", key: `g:${group.value}`, group },
				...(group.folded
					? []
					: [
							...group.list.rows.map((row) => ({ kind: "row", key: String(row.ID), row })),
							...(group.list.hasMore ? [{ kind: "more", key: `m:${group.value}`, group }] : []),
						]),
			])
		: (requests ?? []).map((row) => ({ kind: "row", key: String(row.ID), row }));
	$: shown = groups ? (total ?? 0) : (requests?.length ?? 0);

	// Asks for a group's next page once its "more" row nears the view.
	function nearView(node, value) {
		const observer = new IntersectionObserver(
			(entries) => entries.some((entry) => entry.isIntersecting) && onLoadMore(value),
			{ root: list, rootMargin: `${LOAD_AHEAD}px` },
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	// Asks for the next page when the end is near, or when the rows don't
	// fill the list yet.
	function nearEnd() {
		if (!list || !hasMore || groups) return;
		if (list.scrollHeight - list.scrollTop - list.clientHeight < LOAD_AHEAD) onLoadMore();
	}

	function scrolled() {
		onScroll(list.scrollTop);
		nearEnd();
	}

	onMount(() => {
		if (list) list.scrollTop = scrollTop;
	});
	afterUpdate(nearEnd);

	// A new sort or grouping reads from the top, so the list goes back to
	// it. `sort` is a new object on every store update, so it compares by
	// value.
	$: sortKey = `${sort.column} ${sort.desc} ${groupBy}`;
	$: scrollToTop(sortKey);
	function scrollToTop() {
		if (list) list.scrollTop = 0;
	}

	// Stepping through the drawer keeps the open row in view.
	$: revealOpenRow(openId);
	async function revealOpenRow(id) {
		if (id == null) return;
		await tick();
		list?.querySelector(`[data-pair-id="${CSS.escape(String(id))}"]`)?.scrollIntoView({ block: "nearest" });
	}

	function sortAria(sort, column) {
		if (sort.column !== column.key) return "none";
		return sort.desc ? "descending" : "ascending";
	}

	// Dimmed cells use a translucent text colour, as in the Ledger.
	const dim = "text-black/60 dark:text-surface-50/60";
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden">
	<header
		class="flex flex-none flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-surface-50 px-3 py-1 dark:bg-surface-900 {open
			? 'border-b border-surface-500/30'
			: ''}"
	>
		<button
			type="button"
			class="flex min-w-0 items-center gap-1.5 py-0.5 text-left text-xs"
			aria-expanded={open}
			title={open ? "Hide traffic" : "Show traffic"}
			on:click={() => (open = !open)}
		>
			{#if open}<ChevronDown size={13} />{:else}<ChevronUp size={13} />{/if}
			<span class="trim font-bold">Traffic</span>
			{#if requests}
				<span class="trim whitespace-nowrap opacity-60"
					>{shown.toLocaleString()}{hasMore && !groups ? "+" : ""} items</span
				>
			{/if}
		</button>
		{#if open && requests}
			<div class="mr-auto flex items-center gap-1" role="radiogroup" aria-label="Group by">
				<span class="trim mr-0.5 whitespace-nowrap text-xs opacity-60">Group by</span>
				{#each GROUPINGS as grouping (grouping.label)}
					<button
						type="button"
						class="btn btn-sm h-5 rounded-none px-2 py-0 text-2xs {groupBy === grouping.key
							? primary
							: 'hover:bg-surface-500/15'}"
						role="radio"
						aria-checked={groupBy === grouping.key}
						on:click={() => onGroupBy(grouping.key)}><span class="trim">{grouping.label}</span></button
					>
				{/each}
				{#if groups}
					<button
						type="button"
						class="btn-icon btn-icon-sm ml-1 h-5 w-5 rounded-none hover:bg-surface-500/15"
						title="Expand all"
						aria-label="Expand all"
						on:click={onExpandAll}><ChevronsUpDown size={13} /></button
					>
					<button
						type="button"
						class="btn-icon btn-icon-sm h-5 w-5 rounded-none hover:bg-surface-500/15"
						title="Collapse all"
						aria-label="Collapse all"
						on:click={onCollapseAll}><ChevronsDownUp size={13} /></button
					>
				{/if}
			</div>
		{/if}
		{#if open && selectionLabel}
			<span class="ml-auto flex items-center gap-2 whitespace-nowrap text-xs">
				<span class="trim opacity-60">{selectionLabel} · right-click for actions</span>
				<button
					type="button"
					class="btn btn-sm h-6 rounded-none px-2 py-0 text-xs {primary}"
					title="Clear the selection"
					on:click={onClearSelection}
				>
					Clear
				</button>
			</span>
		{/if}
		{#if open && newLabel}
			<button
				type="button"
				class="btn btn-sm h-6 rounded-none py-0 text-xs {primary}"
				title="Show them, from the top"
				on:click={onShowNew}
			>
				{newLabel} · Show
			</button>
		{/if}
	</header>
	{#if open}
		<div
			bind:this={list}
			class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden font-mono"
			role="grid"
			aria-rowcount={requests?.length ?? 0}
			on:scroll={scrolled}
		>
			{#if !requests}
				<p class="p-4 text-center font-sans text-xs opacity-60">Select a run to view traffic</p>
			{:else if items.length === 0 && !(groups && groups.some((g) => g.folded))}
				<p class="p-4 text-center font-sans text-xs opacity-60">No requests captured yet</p>
			{:else}
				<div
					class="tr-row sticky top-0 z-10 h-6 border-b border-primary-500 bg-surface-100 font-sans font-semibold dark:bg-surface-800"
					style="grid-template-columns: {TRAFFIC_TEMPLATE}"
					role="row"
				>
					{#each TRAFFIC_COLUMNS as column (column.key)}
						{#if column.sortable && isSortable(column.key)}
							<button
								type="button"
								class="tr-sort hover:text-primary-500 {column.align === 'right'
									? 'justify-end'
									: ''} {sort.column === column.key ? 'text-primary-500' : ''}"
								role="columnheader"
								aria-sort={sortAria(sort, column)}
								title="Sort by {column.label}"
								on:click={() => onSort(column.key)}
							>
								{column.label}
								{#if sort.column === column.key}
									{#if sort.desc}<ArrowDown size={11} />{:else}<ArrowUp size={11} />{/if}
								{/if}
							</button>
						{:else}
							<span class={column.align === "right" ? "text-right" : ""} role="columnheader">{column.label}</span>
						{/if}
					{/each}
				</div>
				{#each items as item, index (item.key)}
					{#if item.kind === "group"}
						{@const group = item.group}
						<button
							type="button"
							class="tr-group relative flex h-6 w-full items-center gap-2 border-b border-surface-500/30 bg-surface-100/70 px-2 text-left font-sans text-2xs hover:bg-surface-200 dark:bg-surface-800/60 dark:hover:bg-surface-700"
							aria-expanded={!group.folded}
							title={group.folded ? "Expand" : "Fold"}
							on:click={(event) => onGroupClick(group, { toggle: event.metaKey || event.ctrlKey })}
						>
							<!-- The tint fills to the group's share of the run, with a sliver for the smallest. -->
							<span
								class="pointer-events-none absolute inset-y-0 left-0 bg-primary-500/15 dark:bg-primary-400/25"
								style="width: {Math.max(group.share, 0.6)}%"
								aria-hidden="true"
							></span>
							<span class="relative flex-none opacity-60"
								>{#if group.folded}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}</span
							>
							<span class="trim relative flex-none font-mono font-semibold">{groupLabel(groupBy, group.value)}</span>
							<!-- The count; amber for a lone pair, the outlier. -->
							<span
								class="relative flex-none px-1.5 py-[3px] text-3xs tabular-nums {group.count === 1
									? 'variant-soft-warning'
									: 'bg-surface-200 dark:bg-surface-700'}"
								title={group.count === 1 ? "Outlier: the only pair with this value" : undefined}
								><span class="trim block">{group.count.toLocaleString()}</span></span
							>
							<span class="flex-1"></span>
							<span class="trim relative w-12 flex-none whitespace-nowrap text-right tabular-nums opacity-60"
								>{shareText(group.share)}</span
							>
						</button>
					{:else if item.kind === "more"}
						<button
							type="button"
							class="block h-[1.375rem] w-full border-b border-surface-300/50 text-center font-sans text-2xs opacity-60 hover:opacity-100 dark:border-surface-700/60"
							use:nearView={item.group.value}
							on:click={() => onLoadMore(item.group.value)}><span class="trim">Load more</span></button
						>
					{:else}
						{@const row = item.row}
						{@const focused = sameID(row.ID, openId)}
						{@const selected = selectedIds.has(String(row.ID))}
						<button
							type="button"
							class="tr-row relative h-[1.375rem] w-full border-b border-surface-300/50 text-left dark:border-surface-700/60 {selected
								? 'bg-primary-500/25'
								: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
							style="grid-template-columns: {TRAFFIC_TEMPLATE}"
							role="row"
							aria-selected={selected}
							aria-current={focused || undefined}
							data-pair-id={String(row.ID)}
							on:mousedown={(event) => event.shiftKey && event.preventDefault()}
							on:click={(event) =>
								onClick(row, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey })}
							on:contextmenu|preventDefault={(event) => onMenu(row, index, event)}
						>
							{#if focused}
								<!-- The focus frame, as in the Ledger: over the row's bottom border. -->
								<span
									class="tr-focus pointer-events-none absolute inset-x-0 -bottom-px top-0 border border-primary-500"
									aria-hidden="true"
								></span>
							{/if}
							<span class="text-right tabular-nums {dim}">{row.Number || ""}</span>
							<span class={dim}>{shortTime(row.RequestedAt)}</span>
							<span class={METHOD_CLASS[row.Method] ?? ""}>{row.Method ?? ""}</span>
							<span class="tr-url" title="{row.Host ?? ''}{row.Path ?? ''}"
								><span class="tr-host {dim}">{row.Host ?? ""}</span><span class="tr-path">{row.Path ?? ""}</span></span
							>
							<span class="text-right {statusClass(row.StatusCode)}">{statusText(row.StatusCode)}</span>
							<span class="text-right {dim}">{formatSize(row.Length)}</span>
						</button>
					{/if}
				{/each}
			{/if}
		</div>
	{/if}
</section>

<style>
	.tr-row {
		display: grid;
		align-items: center;
		font-size: 0.6875rem;
		white-space: nowrap;
	}
	/* As the Ledger's cells: trimmed to their capitals so WebKit centres the
	   text, clipped only sideways so the ellipsis shows. */
	.tr-row > :global(*:not(.tr-focus)) {
		overflow-x: clip;
		overflow-y: visible;
		text-overflow: ellipsis;
		text-box: trim-both cap alphabetic;
		padding: 0 6px;
	}
	/* Host and path share the cell, but the host gives up its room first,
	   so a narrow table still shows the path. */
	.tr-row > .tr-url {
		display: flex;
	}
	.tr-url > span {
		min-width: 0;
		overflow-x: clip;
		text-overflow: ellipsis;
		text-box: trim-both cap alphabetic;
	}
	/* Trimmed to the capitals, as the rows are, so the top bar's and a group
	   header's items share one centre line. */
	.trim {
		text-box: trim-both cap alphabetic;
	}
	/* A sortable header: its label and arrow side by side. */
	.tr-row > .tr-sort {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 100%;
	}
	.tr-host {
		flex: 0 1000 auto;
	}
	.tr-path {
		flex: 0 1 auto;
	}
</style>
