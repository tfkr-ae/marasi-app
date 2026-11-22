<script>
	// The Messages modal's shared message table and detail pane: the list
	// (#, direction arrow, then the kind's columns), keyboard selection,
	// follow-the-bottom scrolling, and the selected message in a read-only
	// editor under the kind's detail bar. On a narrow phone screen the list
	// and the detail are pane tabs (PaneTabs); tapping a message opens it.
	// The kind supplies its columns and formatting through props and slots.
	import { tick } from "svelte";
	import { writable } from "svelte/store";
	import {
		createSvelteTable,
		getCoreRowModel,
		getSortedRowModel,
		flexRender,
		createColumnHelper,
	} from "@tanstack/svelte-table";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../launchpad/format.js";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { ArrowDown, ArrowDownLeft, ArrowUpRight } from "lucide-svelte";
	import { marasiConfig, lineWrap } from "../../stores";
	import { longStrings } from "../longStrings.js";
	import { directionArrow } from "./kinds.js";
	import PaneTabs from "../components/PaneTabs.svelte";

	/** The messages, in the order the kind keeps them. */
	export let messages = [];
	/** Changes when the table shows another source, to scroll to its end. */
	export let sourceKey;
	export let loading = false;
	export let error = "";
	/** The message's direction value; sorting the Dir column sorts by it. */
	export let directionOf = (message) => message.Direction;
	/** Whether a message goes the request (client) way: an up arrow. */
	export let isOutgoing = () => true;
	/** The kind's columns after # and Dir: [{ id, header, cell(message), width? }].
	 * The last one truncates and is tinted for an injected message. */
	export let columns = [];
	export let rowClass = () => "";
	export let rowTitle = () => "";
	export let isInjected = () => false;
	/** The selected message's editor text for the current view. */
	export let detailText = () => "";
	/** The selected message (bindable). */
	export let selected = null;
	/** The kind's detail view name (bindable); detailText reads it. */
	export let view = "";

	let narrowPane = "list";
	let sorting = [{ id: "ID", desc: false }];
	let payloadText = "";
	let tableScroller;
	let autoScroll = true;
	let scrollSource;
	let previousMessageCount = 0;

	function select(message) {
		selected = message || null;
	}

	async function scrollToBottom() {
		await tick();
		if (!tableScroller) return;
		tableScroller.scrollTop = tableScroller.scrollHeight;
	}

	function handleTableScroll() {
		if (!tableScroller) return;
		const distanceFromBottom =
			tableScroller.scrollHeight -
			tableScroller.scrollTop -
			tableScroller.clientHeight;
		autoScroll = distanceFromBottom <= 8;
	}

	export function jumpToBottom() {
		autoScroll = true;
		scrollToBottom();
	}

	async function selectAtIndex(rows, index) {
		if (index < 0 || index >= rows.length) return;
		select(rows[index].original);
		if (index === rows.length - 1) {
			jumpToBottom();
			return;
		}

		autoScroll = false;
		await tick();
		tableScroller
			?.querySelectorAll("tbody tr")
			[index]?.scrollIntoView({ block: "nearest" });
	}

	$: {
		const messageCount = messages.length;
		if (sourceKey !== scrollSource) {
			scrollSource = sourceKey;
			previousMessageCount = messageCount;
			autoScroll = true;
			scrollToBottom();
		} else if (messageCount > previousMessageCount && autoScroll) {
			previousMessageCount = messageCount;
			scrollToBottom();
		} else {
			previousMessageCount = messageCount;
		}
	}

	export function selectPrevious() {
		const rows = $table?.getRowModel()?.rows || [];
		const index = rows.findIndex((row) => row.original.ID === selected?.ID);
		selectAtIndex(rows, index - 1);
	}

	export function selectNext() {
		const rows = $table?.getRowModel()?.rows || [];
		const index = rows.findIndex((row) => row.original.ID === selected?.ID);
		if (index >= 0) selectAtIndex(rows, index + 1);
	}

	const columnHelper = createColumnHelper();
	const tableColumns = [
		columnHelper.accessor("ID", {
			header: "#",
			cell: () => "",
			sortingFn: "text",
		}),
		columnHelper.accessor((message) => directionOf(message), {
			id: "Direction",
			header: "Dir",
		}),
		...columns.map((column) =>
			columnHelper.display({
				id: column.id,
				header: column.header,
				cell: (info) => column.cell(info.row.original),
				enableSorting: false,
			}),
		),
	];
	const widths = {
		ID: "w-12",
		Direction: "w-10",
		...Object.fromEntries(columns.map((column) => [column.id, column.width || ""])),
	};
	const lastColumn = tableColumns[tableColumns.length - 1].id;

	const setSorting = (updater) => {
		sorting =
			typeof updater === "function"
				? updater(sorting)
				: updater;
		options.update((old) => ({
			...old,
			state: { ...old.state, sorting },
		}));
	};

	const options = writable({
		data: [],
		columns: tableColumns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	$: options.update((old) => ({
		...old,
		data: messages,
		state: { ...old.state, sorting },
	}));

	$: table = createSvelteTable(options);

	$: {
		const rows = $table?.getRowModel()?.rows || [];
		if (rows.length === 0) {
			select(null);
		} else if (
			!selected ||
			!rows.some((r) => r.original.ID === selected.ID)
		) {
			select(rows[0].original);
		}
	}

	$: payloadText = selected ? detailText(selected, view) : "";
</script>

<div class="flex h-full min-h-0 w-full min-w-0 flex-col">
	{#if error}
		<div class="mb-2 text-sm text-error-500">{error}</div>
	{/if}

	{#if loading && messages.length === 0}
		<div class="p-4 text-xs opacity-60">Loading…</div>
	{:else}
		<PaneTabs
			tabs={[
				{ id: "list", label: "Messages" },
				{ id: "detail", label: "Message" },
			]}
			bind:active={narrowPane}
		/>
		<div class="msg-panes flex min-h-0 w-full min-w-0 flex-1">
			<!-- left: table -->
			<div
				class="no-select relative min-h-0 w-1/2 min-w-0 border-r border-surface-500/30 font-mono text-xs"
				class:pane-off={narrowPane !== "list"}
			>
				<div
					bind:this={tableScroller}
					class="h-full overflow-y-auto overflow-x-hidden"
					on:scroll={handleTableScroll}
				>
					<table class="table table-hover table-compact w-full table-fixed">
						<thead class="sticky top-0 z-10 bg-surface-100-800-token">
							{#each $table.getHeaderGroups() as headerGroup}
								<tr class="h-10">
									{#each headerGroup.headers as header}
										<th colspan={header.colSpan} class="!py-2 {widths[header.column.id]}">
											{#if !header.isPlaceholder}
												<div
													class="inline-flex items-center gap-1 whitespace-nowrap outline-none focus:outline-none"
													class:cursor-pointer={header.column.getCanSort()}
													class:select-none={header.column.getCanSort()}
													on:click={header.column.getToggleSortingHandler()}
													on:keydown
													role="button"
													tabindex="-1"
												>
													<span>
														<svelte:component
															this={flexRender(header.column.columnDef.header, header.getContext())}
														/>
													</span>
													{#if header.column.getIsSorted() === "asc"}
														<span>&uarr;</span>
													{:else if header.column.getIsSorted() === "desc"}
														<span>&darr;</span>
													{/if}
												</div>
											{/if}
										</th>
									{/each}
								</tr>
							{/each}
						</thead>
						<tbody>
							{#each $table.getRowModel().rows as row, i (row.original.ID)}
								<tr
									class="cursor-pointer {selected?.ID === row.original.ID
										? 'bg-surface-500/20 outline outline-1 outline-offset-[-1px] outline-primary-500'
										: ''} {rowClass(row.original)}"
									title={rowTitle(row.original)}
									on:click={() => {
										narrowPane = "detail";
										select(row.original);
									}}
								>
									{#each row.getVisibleCells() as cell}
										<td class="overflow-hidden">
											{#if cell.column.id === "ID"}
												{i + 1}
											{:else if cell.column.id === "Direction"}
												{@const arrow = directionArrow(isOutgoing(row.original))}
												{#if arrow.up}
													<ArrowUpRight size={14} class={arrow.class} />
												{:else}
													<ArrowDownLeft size={14} class={arrow.class} />
												{/if}
											{:else if cell.column.id === lastColumn}
												<div
													class="truncate"
													class:text-tertiary-500={isInjected(row.original)}
												>
													<svelte:component
														this={flexRender(cell.column.columnDef.cell, cell.getContext())}
													/>
												</div>
											{:else}
												<svelte:component
													this={flexRender(cell.column.columnDef.cell, cell.getContext())}
												/>
											{/if}
										</td>
									{/each}
								</tr>
							{:else}
								<tr>
									<td colspan={tableColumns.length} class="p-4 text-center opacity-60">
										No messages yet
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if !autoScroll && messages.length > 0}
					<button
						class="btn btn-sm {primaryVariant($modeCurrent)} absolute bottom-3 left-1/2 z-20 -translate-x-1/2 shadow-lg"
						on:click={jumpToBottom}
					>
						<ArrowDown size={14} />
						Jump to bottom
					</button>
				{/if}
			</div>

			<!-- right: header-aligned toolbar + editor aligned to first row -->
			<div class="flex min-h-0 w-1/2 min-w-0 flex-col" class:pane-off={narrowPane !== "detail"}>
				<div
					class="msg-detail-bar flex h-10 shrink-0 items-center justify-between gap-2 border-b border-surface-500/30 bg-surface-100-800-token px-2 text-xs"
				>
					<div class="flex min-w-0 items-center gap-2 opacity-80">
						{#if selected}
							<slot name="summary" {selected} />
						{:else}
							<span class="opacity-60">No message selected</span>
						{/if}
						<slot name="status" />
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<slot name="actions" {selected} />
					</div>
				</div>

				{#if selected}
					<slot name="properties" {selected} />
				{/if}

				<div class="min-h-0 flex-1 overflow-auto">
					{#if selected}
						<CodeMirror
							class="text-xs h-full w-full"
							bind:value={payloadText}
							theme={$modeCurrent ? githubLight : oneDark}
							extensions={[...($marasiConfig.VimEnabled ? [vim()] : []), longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode })]}
							readonly={true}
						/>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	@media (max-width: 40rem) {
		:global(html.mobile .msg-panes > div) {
			width: 100%;
			border-right-width: 0;
		}
		:global(html.mobile .msg-detail-bar) {
			flex-wrap: wrap;
			height: auto;
			min-height: 2.5rem;
			padding-top: 0.25rem;
			padding-bottom: 0.25rem;
			row-gap: 0.25rem;
		}
	}
</style>
