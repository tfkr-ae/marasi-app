<script>
	// The Messages modal's shared message table and detail pane: the list
	// (#, direction arrow, then the kind's columns), keyboard selection,
	// follow-the-bottom scrolling, and the selected message in a read-only
	// editor under the kind's detail bar. On a narrow phone screen the list
	// and the detail are pane tabs (PaneTabs); tapping a message opens it.
	// The kind supplies its columns and formatting through props and slots.
	// Rows are keyed MessageRow components, so a live message adds a row
	// rather than redrawing the list.
	import { tick } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../launchpad/format.js";
	import CodeMirror from "svelte-codemirror-editor";
	import { vim } from "@replit/codemirror-vim";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { ArrowDown } from "lucide-svelte";
	import { marasiConfig, lineWrap } from "../../stores";
	import { longStrings } from "../longStrings.js";
	import { sortMessages, toggleSort } from "./messageSort.js";
	import MessageRow from "./MessageRow.svelte";
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
	/** A row's number in the # column; by default its place in the list. */
	export let numberOf = (_message, index) => index + 1;
	/** Chips shown before the last column's text: [{ label, class, title? }]. */
	export let rowChips = () => [];
	/** The selected message's editor extensions, such as a highlighter. */
	export let detailExtensions = () => [];
	/** Whether messages are left unloaded: the `gap` slot shows before the
	 * message `gapBefore` names (the first one past them), or after the
	 * list when it names none. */
	export let gap = false;
	export let gapBefore = null;

	let narrowPane = "list";
	let sorting = { id: "ID", desc: false };
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
		select(rows[index]);
		if (index === rows.length - 1) {
			jumpToBottom();
			return;
		}

		autoScroll = false;
		await tick();
		tableScroller
			?.querySelectorAll("tbody tr:not([data-gap])")
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
		const index = rows.findIndex((row) => row.ID === selected?.ID);
		selectAtIndex(rows, index - 1);
	}

	export function selectNext() {
		const index = rows.findIndex((row) => row.ID === selected?.ID);
		if (index >= 0) selectAtIndex(rows, index + 1);
	}

	// The header: # and Dir sort (by id, by direction); the kind's columns
	// don't.
	$: headers = [
		{ id: "ID", header: "#", width: "w-12", sortable: true },
		{ id: "Direction", header: "Dir", width: "w-10", sortable: true },
		...columns.map((column, i) => ({
			id: column.id,
			header: column.header,
			width: column.width || "",
			sortable: false,
			extra: i !== columns.length - 1,
		})),
	];

	$: rows = sortMessages(messages, sorting, directionOf);

	const onSelect = (message) => {
		narrowPane = "detail";
		select(message);
	};

	$: {
		if (rows.length === 0) {
			select(null);
		} else if (!selected || !rows.some((r) => r.ID === selected.ID)) {
			select(rows[0]);
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
				{#if $$slots.listBar}
					<div
						class="msg-list-bar flex h-10 shrink-0 items-center gap-1 border-b border-surface-500/30 bg-surface-100-800-token px-2 font-sans"
					>
						<slot name="listBar" />
					</div>
				{/if}
				<div
					bind:this={tableScroller}
					class="overflow-y-auto overflow-x-hidden {$$slots.listBar ? 'h-[calc(100%-2.5rem)]' : 'h-full'}"
					on:scroll={handleTableScroll}
				>
					<table class="msg-table table table-hover table-compact w-full table-fixed">
						<thead class="sticky top-0 z-10 bg-surface-100-800-token">
							<tr class="h-10">
								{#each headers as header (header.id)}
									<th class="!py-2 {header.width}" class:msg-extra={header.extra}>
										<div
											class="inline-flex items-center gap-1 whitespace-nowrap outline-none focus:outline-none"
											class:cursor-pointer={header.sortable}
											class:select-none={header.sortable}
											on:click={() => header.sortable && (sorting = toggleSort(sorting, header.id))}
											on:keydown
											role="button"
											tabindex="-1"
										>
											<span>{header.header}</span>
											{#if sorting?.id === header.id}
												<span>{sorting.desc ? "↓" : "↑"}</span>
											{/if}
										</div>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each rows as message, i (message.ID)}
								{#if gap && message.ID === gapBefore}
									<tr data-gap>
										<td colspan={headers.length} class="p-0 font-sans"><slot name="gap" /></td>
									</tr>
								{/if}
								<MessageRow
									{message}
									number={numberOf(message, i)}
									selected={selected?.ID === message.ID}
									{columns}
									{rowClass}
									{rowTitle}
									{isInjected}
									{isOutgoing}
									{rowChips}
									{onSelect}
								/>
							{:else}
								<tr>
									<td colspan={headers.length} class="p-4 text-center opacity-60">
										No messages yet
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if gap && gapBefore == null}
						<div class="font-sans"><slot name="gap" /></div>
					{/if}
					<slot name="listEnd" />
				</div>
				{#if !autoScroll && messages.length > 0}
					<!-- An opaque backing: the light theme's ghost button would let
					     the rows show through. -->
					<div class="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 bg-surface-50-900-token shadow-lg">
						<button class="btn btn-sm {primaryVariant($modeCurrent)}" on:click={jumpToBottom}>
							<ArrowDown size={14} />
							Jump to bottom
						</button>
					</div>
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
							extensions={[
								...($marasiConfig.VimEnabled ? [vim()] : []),
								longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode }),
								...detailExtensions(selected, view),
							]}
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
		/* The list keeps #, Dir and the kind's last column (the preview),
		   so the preview is readable; the detail shows the message's time.
		   The others collapse to no width rather than leave the table, so the
		   gap row's colspan still matches its columns. */
		:global(html.mobile .msg-table .msg-extra) {
			width: 0;
			padding: 0 !important;
			visibility: hidden;
		}
		/* Skeleton's .table hides its overflow, which pins the sticky header
		   to the table instead of the scroller. */
		:global(html.mobile .msg-table) {
			overflow: visible;
		}
		:global(html.mobile .msg-panes > div) {
			width: 100%;
			border-right-width: 0;
		}
		:global(html.mobile .msg-list-bar),
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
