<script>
	// The streamed pair kind's Messages tab: the shared message table
	// (MessagesTable.svelte) over the pair's stream messages in arrival
	// order, with a direction filter, chips for what happened to each
	// message, Load more, and a detail pane showing the protobuf text form
	// (or UTF-8 text, or read-only hex) with Raw and Metadata toggles.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Binary, Braces, ChevronsDown } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import { streamedPairStore } from "../../stores/streamedPairStore.js";
	import MessagesTable from "./MessagesTable.svelte";
	import { detailOf, messageChips, messagePreview, messageSize, messageTime } from "./streamMessage.js";
	import { languageExtensions } from "./protobufText.js";

	export let pairId;

	const FILTERS = [
		{ id: "all", label: "All" },
		{ id: "request", label: "↑ Request" },
		{ id: "response", label: "↓ Response" },
	];

	let filter = "all";
	let selected = null;
	let view = "text"; // "text" | "raw" | "metadata"
	let table;

	$: pair = $streamedPairStore.pairs[pairId];
	$: all = pair?.messages ?? [];
	// Each message's number in the whole call, whatever the filter shows.
	$: numbers = new Map(all.map((m, i) => [m.ID, i + 1]));
	$: messages = filter === "all" ? all : all.filter((m) => m.Direction === filter);
	$: details = pair?.details ?? {};
	$: if (selected) streamedPairStore.select(pairId, selected.ID);
	$: shown = selected ? detailOf(selected, details[selected.ID], view) : null;
	// New functions when the detail changes, so the table redraws it.
	$: detailText = (message, v) => detailOf(message, details[message.ID], v).text;
	$: detailExtensions = (message, v) => languageExtensions(detailOf(message, details[message.ID], v).language);

	const columns = [
		{ id: "time", header: "Time", width: "w-28", cell: (m) => messageTime(m.CreatedAt) },
		{ id: "size", header: "Size", width: "w-20", cell: (m) => messageSize(m) },
		{ id: "message", header: "Message", cell: (m) => messagePreview(m) },
	];

	const rowClass = (m) => (m.Metadata?.dropped ? "line-through decoration-error-500/70 opacity-70" : "");

	export function selectPrevious() {
		table?.selectPrevious();
	}

	export function selectNext() {
		table?.selectNext();
	}

	export function jumpToBottom() {
		table?.jumpToBottom();
	}

	export function toggleMetadata() {
		if (selected) view = view === "metadata" ? "text" : "metadata";
	}

	export function toggleRaw() {
		if (selected) view = view === "raw" ? "text" : "raw";
	}
</script>

<MessagesTable
	bind:this={table}
	bind:selected
	{view}
	{messages}
	loading={pair?.loading ?? true}
	error={pair?.error ?? ""}
	{columns}
	{rowClass}
	{detailText}
	{detailExtensions}
	sourceKey={pairId}
	directionOf={(m) => m.Direction}
	isOutgoing={(m) => m.Direction === "request"}
	isInjected={(m) => Boolean(m.Metadata?.injected)}
	numberOf={(m) => numbers.get(m.ID)}
	rowChips={messageChips}
>
	<svelte:fragment slot="listBar">
		{#each FILTERS as option (option.id)}
			<button
				class="btn btn-sm {filter === option.id ? primaryVariant($modeCurrent) : ''}"
				aria-pressed={filter === option.id}
				on:click={() => (filter = option.id)}>{option.label}</button
			>
		{/each}
	</svelte:fragment>
	<svelte:fragment slot="listEnd">
		{#if pair?.hasMore}
			<div class="flex justify-center p-2 font-sans">
				<button
					class="btn btn-sm {primaryVariant($modeCurrent)}"
					disabled={pair.loadingMore}
					on:click={() => streamedPairStore.loadMore(pairId)}
				>
					<ChevronsDown size={14} class="mr-1" />
					{pair.loadingMore ? "Loading…" : "Load more"}
				</button>
			</div>
		{/if}
	</svelte:fragment>
	<svelte:fragment slot="summary" let:selected={message}>
		<span class="chip variant-soft-surface text-xs">{message.Framing}</span>
		<span class="whitespace-nowrap">{messageTime(message.CreatedAt)}</span>
		<span class="opacity-60">{message.Direction}</span>
	</svelte:fragment>
	<svelte:fragment slot="actions">
		<button
			class="btn btn-sm {primaryVariant($modeCurrent)}"
			disabled={!selected || view === "metadata"}
			aria-pressed={view === "raw"}
			on:click={toggleRaw}
		>
			<Binary size={14} class="mr-1" />
			{view === "raw" ? "Text form" : "Raw"}
		</button>
		<button class="btn btn-sm {primaryVariant($modeCurrent)}" disabled={!selected} on:click={toggleMetadata}>
			<Braces size={14} class="mr-1" />
			{view === "metadata" ? "View Message" : "Metadata"}
		</button>
	</svelte:fragment>
	<svelte:fragment slot="properties">
		{#if shown?.note}
			<div class="shrink-0 border-b border-surface-500/30 px-3 py-1 text-xs opacity-70">{shown.note}</div>
		{/if}
	</svelte:fragment>
</MessagesTable>
