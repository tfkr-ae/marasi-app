<script>
	import { tick } from "svelte";
	import { writable } from "svelte/store";
	import {
		createSvelteTable,
		getCoreRowModel,
		getSortedRowModel,
		flexRender,
		createColumnHelper,
	} from "@tanstack/svelte-table";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { ayuLight } from "thememirror";
	import {
		ArrowDown,
		ArrowDownLeft,
		ArrowUpRight,
		Braces,
		Send,
	} from "lucide-svelte";
	import {
		connectionStore,
		wsInjectDraft,
	} from "../../stores/connectionStore";
	import { marasiConfig, lineWrap } from "../../stores";

	export let requestId;
	export let onOpenInject = () => {};

	const toastStore = getToastStore();

	let loading = true;
	let error = "";
	let sorting = [{ id: "ID", desc: false }];
	let selected = null;
	let view = "frame"; // "frame" | "metadata"
	let payloadText = "";
	let tableScroller;
	let autoScroll = true;
	let scrollRequestId;
	let previousMessageCount = 0;

	$: messages = $connectionStore.messagesByRequestId[requestId] || [];
	$: connectionState =
		$connectionStore.connectionsByRequestId[requestId]?.State || "";

	const opcodeLabel = {
		0: "cont",
		1: "text",
		2: "binary",
		8: "close",
		9: "ping",
		10: "pong",
	};

	function formatMetadata(msg) {
		return JSON.stringify(msg?.Metadata || {}, null, 2);
	}

	function formatPayload(msg, preview = false) {
		if (!msg?.Payload) return "";
		let bytes = msg.Payload;
		if (typeof bytes === "string") {
			try {
				const bin = atob(bytes);
				bytes = Uint8Array.from(bin, (c) =>
					c.charCodeAt(0),
				);
			} catch {
				return bytes;
			}
		} else if (Array.isArray(bytes)) {
			bytes = Uint8Array.from(bytes);
		}
		if (!(bytes instanceof Uint8Array)) return String(msg.Payload);

		if (msg.Opcode === 8) {
			if (bytes.length < 2) return "close";
			const code = (bytes[0] << 8) | bytes[1];
			const reason = new TextDecoder().decode(bytes.slice(2));
			return reason
				? `close ${code}: ${reason}`
				: `close ${code}`;
		}
		if (msg.Opcode === 2 || msg.IsBinary) {
			const slice = preview ? bytes.slice(0, 32) : bytes;
			const hex = Array.from(slice)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(" ");
			return preview && bytes.length > 32 ? `${hex} …` : hex;
		}
		const text = new TextDecoder().decode(bytes);
		if (preview && text.length > 80) return text.slice(0, 80) + "…";
		return text;
	}

	function formatTime(value) {
		if (!value) return "";
		return new Date(value).toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	}

	function frameStateClasses(msg) {
		const closeFrame = msg.Opcode === 8 ? "!bg-primary-500/10" : "";
		const dropped = msg.Metadata?.dropped
			? "line-through decoration-error-500/70"
			: "";
		return `${closeFrame} ${dropped}`;
	}

	function frameStateTitle(msg) {
		if (msg.Metadata?.dropped) return "Dropped intercepted frame";
		if (msg.Metadata?.intercepted) return "Forwarded intercepted frame";
		return "";
	}

	function selectFrame(msg) {
		if (!msg) {
			selected = null;
			payloadText = "";
			return;
		}
		selected = msg;
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

	async function selectFrameAtIndex(rows, index) {
		if (index < 0 || index >= rows.length) return;
		selectFrame(rows[index].original);
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
		const currentRequestId = requestId;
		const messageCount = messages.length;
		if (currentRequestId !== scrollRequestId) {
			scrollRequestId = currentRequestId;
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

	export function selectPreviousFrame() {
		const rows = $table?.getRowModel()?.rows || [];
		const index = rows.findIndex((row) => row.original.ID === selected?.ID);
		selectFrameAtIndex(rows, index - 1);
	}

	export function selectNextFrame() {
		const rows = $table?.getRowModel()?.rows || [];
		const index = rows.findIndex((row) => row.original.ID === selected?.ID);
		if (index >= 0) selectFrameAtIndex(rows, index + 1);
	}

	export function toggleView() {
		if (!selected) return;
		view = view === "frame" ? "metadata" : "frame";
	}

	export function copyToInject() {
		if (!selected) return;
		wsInjectDraft.set({
			requestId,
			direction: selected.Direction || "client",
			opcode: selected.Opcode ?? 1,
			payload: formatPayload(selected),
		});
		onOpenInject();
		toastStore.trigger({
			message: "Copied to Inject",
			background: "variant-filled-success",
		});
	}

	async function load() {
		if (!requestId) return;
		loading = true;
		error = "";
		try {
			await connectionStore.populate(requestId);
		} catch (err) {
			error = String(err);
		} finally {
			loading = false;
		}
	}

	const columnHelper = createColumnHelper();
	const columns = [
		columnHelper.accessor("ID", {
			header: "#",
			cell: () => "",
			sortingFn: "text",
		}),
		columnHelper.accessor("Direction", { header: "Dir" }),
		columnHelper.display({
			id: "payload",
			header: "Payload",
			cell: (info) => formatPayload(info.row.original, true),
			enableSorting: false,
		}),
	];

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
		columns,
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
	$: if (requestId) load();

	$: {
		const rows = $table?.getRowModel()?.rows || [];
		if (rows.length === 0) {
			selectFrame(null);
		} else if (
			!selected ||
			!rows.some((r) => r.original.ID === selected.ID)
		) {
			selectFrame(rows[0].original);
		}
	}

	$: if (selected) {
		payloadText =
			view === "metadata"
				? formatMetadata(selected)
				: formatPayload(selected);
	} else {
		payloadText = "";
	}
</script>

<div class="flex h-full min-h-0 w-full min-w-0 flex-col">
	{#if error}
		<div class="mb-2 text-sm text-error-500">{error}</div>
	{/if}

	{#if loading && messages.length === 0}
		<div class="p-4 text-sm opacity-60">Loading…</div>
	{:else}
		<div class="flex min-h-0 w-full min-w-0 flex-1">
			<!-- left: table -->
			<div
				class="no-select relative min-h-0 w-1/2 min-w-0 border-r border-surface-500/30 font-mono text-xs"
			>
				<div
					bind:this={tableScroller}
					class="h-full overflow-y-auto overflow-x-hidden"
					on:scroll={handleTableScroll}
				>
					<table
						class="table table-hover table-compact w-full table-fixed"
					>
					<thead
						class="sticky top-0 z-10 bg-surface-100-800-token"
					>
						{#each $table.getHeaderGroups() as headerGroup}
							<tr class="h-10">
								{#each headerGroup.headers as header}
									<th
										colspan={header.colSpan}
										class="!py-2 {header
											.column
											.id ===
										'ID'
											? 'w-12'
											: header
														.column
														.id ===
												  'Direction'
												? 'w-10'
												: ''}"
									>
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
												<span
												>
													<svelte:component
														this={flexRender(
															header
																.column
																.columnDef
																.header,
															header.getContext(),
														)}
													/>
												</span>
												{#if header.column.getIsSorted() === "asc"}
													<span
														>&uarr;</span
													>
												{:else if header.column.getIsSorted() === "desc"}
													<span
														>&darr;</span
													>
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
								class="cursor-pointer {selected?.ID ===
								row.original.ID
									? 'bg-surface-500/20 outline outline-1 outline-offset-[-1px] outline-primary-500'
									: ''} {frameStateClasses(row.original)}"
								title={frameStateTitle(row.original)}
								on:click={() =>
									selectFrame(
										row.original,
									)}
							>
								{#each row.getVisibleCells() as cell}
									<td
										class="overflow-hidden"
									>
										{#if cell.column.id === "ID"}
											{i +
												1}
										{:else if cell.column.id === "Direction"}
											{#if cell.getValue() === "client"}
												<ArrowUpRight
													size={14}
													class="text-primary-500"
												/>
											{:else}
												<ArrowDownLeft
													size={14}
													class="text-secondary-500"
												/>
											{/if}
										{:else}
											<div
												class="truncate"
												class:text-tertiary-500={row.original.Metadata?.injected}
											>
												<svelte:component
													this={flexRender(
														cell
															.column
															.columnDef
															.cell,
														cell.getContext(),
													)}
												/>
											</div>
										{/if}
									</td>
								{/each}
							</tr>
						{:else}
							<tr>
								<td
									colspan={columns.length}
									class="p-4 text-center opacity-60"
								>
									No
									frames
									yet
								</td>
							</tr>
						{/each}
					</tbody>
					</table>
				</div>
				{#if !autoScroll && messages.length > 0}
					<button
						class="btn btn-sm variant-filled-primary absolute bottom-3 left-1/2 z-20 -translate-x-1/2 shadow-lg"
						on:click={jumpToBottom}
					>
						<ArrowDown size={14} />
						Jump to bottom
					</button>
				{/if}
			</div>

			<!-- right: header-aligned toolbar + editor aligned to first row -->
			<div class="flex min-h-0 w-1/2 min-w-0 flex-col">
				<div
					class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-surface-500/30 bg-surface-100-800-token px-2 text-xs"
				>
					<div
						class="flex min-w-0 items-center gap-2 opacity-80"
					>
						{#if selected}
							<span
								class="chip variant-soft-surface text-xs"
							>
								{opcodeLabel[
									selected
										.Opcode
								] ??
									selected.Opcode}
							</span>
							<span
								class="whitespace-nowrap"
								>{formatTime(
									selected.CreatedAt,
								)}</span
							>
							<span class="opacity-60"
								>{selected.Direction}</span
							>
							{#if selected.Metadata?.dropped}
								<span class="chip variant-soft-error text-xs">
									Dropped
								</span>
							{/if}
							{#if selected.Metadata?.injected}
								<span class="chip variant-soft-tertiary text-xs">
									Injected
								</span>
							{/if}
						{:else}
							<span class="opacity-60"
								>No frame
								selected</span
							>
						{/if}
						{#if connectionState === "closed"}
							<span class="chip variant-soft-error text-xs">
								Connection Closed
							</span>
						{/if}
					</div>
					<div
						class="flex shrink-0 items-center gap-1"
					>
						<button
							class="btn btn-sm variant-soft-primary"
							disabled={!selected}
							on:click={toggleView}
						>
							<Braces
								size={14}
								class="mr-1"
							/>
							{view === "metadata"
								? "View Frame"
								: "Metadata"}
						</button>
						<button
							class="btn btn-sm variant-soft-primary"
							disabled={!selected}
							on:click={copyToInject}
						>
							<Send
								size={14}
								class="mr-1"
							/> Copy to Inject
						</button>
					</div>
				</div>

				<div class="min-h-0 flex-1 overflow-auto">
					{#if selected}
						<CodeMirror
							class="text-xs h-full w-full"
							bind:value={payloadText}
							theme={$modeCurrent
								? ayuLight
								: oneDark}
							extensions={$marasiConfig.VimEnabled
								? [vim()]
								: []}
							readonly={true}
							lineWrapping={$lineWrap}
						/>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
