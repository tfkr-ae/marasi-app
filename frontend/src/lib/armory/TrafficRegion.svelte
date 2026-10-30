<script>
	// The selected run's traffic in a table shaped like the Ledger's: a CSS
	// grid with a sticky header and 11px monospace rows. It is one scrolled
	// list that asks for the next page as it nears the end; the rows, sort
	// and open pair are armoryStore's run traffic view
	// (stores/createArmoryRunTraffic.js). Selected rows are tinted across the
	// full row, as in the Ledger; the open pair is framed. The page owns whether the panel is
	// open; the header toggles it.
	import { afterUpdate, onMount, tick } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from "lucide-svelte";
	import { METHOD_CLASS, primaryVariant, shortTime, statusClass } from "../launchpad/format.js";
	import { formatSize, statusText } from "../ledger/table.js";
	import { sameID } from "../ledger/pairs.js";
	import { TRAFFIC_COLUMNS, TRAFFIC_TEMPLATE } from "./traffic.js";

	/** The rows read so far, in the table's order; null when no run is selected. */
	export let requests = null;
	/** Whether pages past the last row are still to read. */
	export let hasMore = false;
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
	export let onLoadMore = () => {};
	export let onShowNew = () => {};
	export let onScroll = (scrollTop) => {};

	// How near the end, in pixels, the list asks for the next page.
	const LOAD_AHEAD = 400;
	let list;

	$: primary = primaryVariant($modeCurrent);

	// Asks for the next page when the end is near, or when the rows don't
	// fill the list yet.
	function nearEnd() {
		if (!list || !hasMore) return;
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

	// A new sort reads from the top, so the list goes back to it. `sort` is
	// a new object on every store update, so it compares by value.
	$: sortKey = `${sort.column} ${sort.desc}`;
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
			<span class="font-bold">Traffic</span>
			{#if requests}
				<span class="whitespace-nowrap opacity-60"
					>{requests.length.toLocaleString()}{hasMore ? "+" : ""} items</span
				>
			{/if}
		</button>
		{#if open && selectionLabel}
			<span class="ml-auto flex items-center gap-2 whitespace-nowrap text-xs">
				<span class="opacity-60">{selectionLabel} · right-click for actions</span>
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
			{:else if requests.length === 0}
				<p class="p-4 text-center font-sans text-xs opacity-60">No requests captured yet</p>
			{:else}
				<div
					class="tr-row sticky top-0 z-10 h-6 border-b border-primary-500 bg-surface-100 font-sans font-semibold dark:bg-surface-800"
					style="grid-template-columns: {TRAFFIC_TEMPLATE}"
					role="row"
				>
					{#each TRAFFIC_COLUMNS as column (column.key)}
						{#if column.sortable}
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
				{#each requests as row, index (String(row.ID))}
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
