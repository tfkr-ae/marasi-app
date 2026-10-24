<script>
	// The selected run's traffic, a page at a time, in a table shaped like the
	// Ledger's: a CSS grid with a sticky header and 11px monospace rows. The
	// page owns the pagination (it persists per run) and whether the panel is
	// open; the header toggles it.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-svelte";
	import { METHOD_CLASS, neutralVariant, shortTime, statusClass } from "../launchpad/format.js";
	import { formatSize, statusText } from "../ledger/table.js";
	import { sameID } from "../ledger/pairs.js";
	import { TRAFFIC_COLUMNS, TRAFFIC_TEMPLATE, trafficPage } from "./traffic.js";

	/** The run's pairs, oldest first; null when no run is selected. */
	export let requests = null;
	/** A store of { pageIndex, pageSize }. */
	export let pagination;
	/** Whether the table shows; the header toggles it. */
	export let open = true;
	/** The ID of the pair open in the drawer, marked in the table. */
	export let openId = null;
	export let onPaginationChange = (updater) => {};
	/** The pager changed the page; the open request drawer closes. */
	export let onPageChange = () => {};
	export let onOpen = (row, index) => {};
	/** A right-click on a row: the page opens the row menu. */
	export let onMenu = (row, index, event) => {};

	$: neutral = neutralVariant($modeCurrent);
	$: page = trafficPage(requests ?? [], $pagination);

	function changePage(pageIndex) {
		onPageChange();
		onPaginationChange((old) => ({ ...old, pageIndex }));
	}

	function changePageSize(event) {
		onPageChange();
		onPaginationChange({ pageIndex: 0, pageSize: Number(event.currentTarget.value) });
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
				<span class="whitespace-nowrap opacity-60">{requests.length.toLocaleString()} items</span>
			{/if}
		</button>
		{#if open && requests?.length}
			<div class="flex shrink-0 items-center gap-1.5 text-xs">
				<label class="flex items-center gap-1">
					<span class="sr-only">Rows per page</span>
					<select class="select h-6 w-16 py-0 text-xs" value={$pagination.pageSize} on:change={changePageSize}>
						{#each [10, 20, 30, 40, 50, 100] as pageSize}
							<option value={pageSize}>{pageSize}</option>
						{/each}
					</select>
				</label>
				<span class="whitespace-nowrap opacity-70">
					{($pagination.pageIndex + 1).toLocaleString()} / {page.pageCount.toLocaleString()}
				</span>
				<button
					type="button"
					class="btn btn-sm h-6 w-6 px-0 {neutral}"
					disabled={$pagination.pageIndex <= 0}
					on:click={() => changePage($pagination.pageIndex - 1)}
					title="Previous page"
					aria-label="Previous page"
				>
					<ChevronLeft size={14} />
				</button>
				<button
					type="button"
					class="btn btn-sm h-6 w-6 px-0 {neutral}"
					disabled={$pagination.pageIndex >= page.pageCount - 1}
					on:click={() => changePage($pagination.pageIndex + 1)}
					title="Next page"
					aria-label="Next page"
				>
					<ChevronRight size={14} />
				</button>
			</div>
		{/if}
	</header>
	{#if open}
		<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden font-mono" role="grid" aria-rowcount={requests?.length ?? 0}>
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
						<span class={column.align === "right" ? "text-right" : ""} role="columnheader">{column.label}</span>
					{/each}
				</div>
				{#each page.rows as row, i (String(row.ID))}
					{@const index = page.start + i}
					{@const focused = sameID(row.ID, openId)}
					<button
						type="button"
						class="tr-row h-[22px] w-full border-b border-surface-300/50 text-left dark:border-surface-700/60 {focused
							? 'bg-primary-500/25'
							: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
						style="grid-template-columns: {TRAFFIC_TEMPLATE}"
						role="row"
						aria-selected={focused}
						on:click={() => onOpen(row, index)}
						on:contextmenu|preventDefault={(event) => onMenu(row, index, event)}
					>
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
		font-size: 11px;
		white-space: nowrap;
	}
	/* As the Ledger's cells: trimmed to their capitals so WebKit centres the
	   text, clipped only sideways so the ellipsis shows. */
	.tr-row > :global(*) {
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
	.tr-host {
		flex: 0 1000 auto;
	}
	.tr-path {
		flex: 0 1 auto;
	}
</style>
