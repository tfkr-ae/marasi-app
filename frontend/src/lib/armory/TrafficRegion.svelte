<script>
	// The selected run's traffic, a page at a time. The page owns the
	// pagination (it persists per run); this draws the list and its pager.
	import { derived, writable } from "svelte/store";
	import {
		createColumnHelper,
		createSvelteTable,
		getCoreRowModel,
	} from "@tanstack/svelte-table";
	import { ChevronLeft, ChevronRight } from "lucide-svelte";

	/** The run's pairs, oldest first; null when no run is selected. */
	export let requests = null;
	/** A store of { pageIndex, pageSize }. */
	export let pagination;
	export let onPaginationChange = (updater) => {};
	/** The pager changed the page; the open request drawer closes. */
	export let onPageChange = () => {};
	export let onOpen = (row, index) => {};

	const rows = writable([]);
	$: rows.set(requests ?? []);

	const columnHelper = createColumnHelper();
	const columns = [
		columnHelper.accessor("Method", { id: "method" }),
		columnHelper.accessor((row) => `${row.Host}${row.Path}`, { id: "url" }),
		columnHelper.accessor("StatusCode", { id: "status" }),
	];
	const options = derived([rows, pagination], ([$data, $pagination]) => {
		const start = $pagination.pageIndex * $pagination.pageSize;
		return {
			data: $data.slice(start, start + $pagination.pageSize),
			columns,
			autoResetPageIndex: false,
			manualPagination: true,
			pageCount: Math.ceil($data.length / $pagination.pageSize),
			state: { pagination: $pagination },
			onPaginationChange,
			getCoreRowModel: getCoreRowModel(),
		};
	});
	const table = createSvelteTable(options);

	function changePage(change) {
		onPageChange();
		change();
	}

	function changePageSize(event) {
		onPageChange();
		onPaginationChange({ pageIndex: 0, pageSize: Number(event.currentTarget.value) });
	}
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden">
	<header class="flex flex-wrap items-center justify-between gap-2 border-b border-surface-500/30 px-3 py-2">
		<div class="flex min-w-0 items-baseline gap-2">
			<h2 class="text-sm font-bold">Traffic</h2>
			{#if requests}
				<span class="whitespace-nowrap text-xs opacity-60">{requests.length.toLocaleString()} items</span>
			{/if}
		</div>
		{#if requests?.length}
			<div class="flex shrink-0 items-center gap-1.5 text-xs">
				<label class="flex items-center gap-1">
					<span class="sr-only">Rows per page</span>
					<select class="select select-sm w-20" value={$pagination.pageSize} on:change={changePageSize}>
						{#each [10, 20, 30, 40, 50, 100] as pageSize}
							<option value={pageSize}>{pageSize}</option>
						{/each}
					</select>
				</label>
				<span class="whitespace-nowrap opacity-70">
					{($pagination.pageIndex + 1).toLocaleString()} /
					{$table.getPageCount().toLocaleString()}
				</span>
				<div class="btn-group btn-group-sm">
					<button
						type="button"
						disabled={!$table.getCanPreviousPage()}
						on:click={() => changePage(() => $table.previousPage())}
						title="Previous page"
						aria-label="Previous page"
					>
						<ChevronLeft size={14} />
					</button>
					<button
						type="button"
						disabled={!$table.getCanNextPage()}
						on:click={() => changePage(() => $table.nextPage())}
						title="Next page"
						aria-label="Next page"
					>
						<ChevronRight size={14} />
					</button>
				</div>
			</div>
		{/if}
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !requests}
			<p class="p-4 text-center text-xs opacity-60">Select a run to view traffic</p>
		{:else if requests.length === 0}
			<p class="p-4 text-center text-xs opacity-60">No requests captured yet</p>
		{:else}
			{#each $table.getRowModel().rows as tableRow (tableRow.original.ID)}
				{@const absoluteIndex = $pagination.pageIndex * $pagination.pageSize + tableRow.index}
				<button
					type="button"
					class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-surface-500/20 px-3 py-2 text-left hover:bg-surface-100-800-token"
					on:click={() => onOpen(tableRow.original, absoluteIndex)}
				>
					<span class="badge variant-soft-primary font-mono text-[10px]">{tableRow.original.Method}</span>
					<span class="truncate text-xs">{tableRow.original.Host}{tableRow.original.Path}</span>
					<span class="font-mono text-xs">{tableRow.original.StatusCode > 0 ? tableRow.original.StatusCode : "-"}</span>
				</button>
			{/each}
		{/if}
	</div>
</section>
