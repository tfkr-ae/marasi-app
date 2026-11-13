<script>
	// The WebSocket modal's read-only Connection tab: URL, state, close, the
	// negotiated permessage-deflate parameters and the offers Marasi stripped.
	import { webSocketStore } from "../../stores/webSocketStore";
	import { connectionSummary } from "../websocket/presentation.js";

	export let requestId;
	export let request = null;
	export let url = "";
	export let state = "";
	export let tone = null;

	// Literal class strings so Tailwind's content scan keeps them.
	const STATE_CHIPS = {
		success: "variant-soft-success",
		warning: "variant-soft-warning",
		error: "variant-soft-error",
	};

	$: summary = connectionSummary({
		connection: $webSocketStore.connectionsByRequestId[requestId] ?? null,
		request,
		messages: $webSocketStore.messagesByRequestId[requestId],
	});
</script>

<div class="h-full overflow-auto p-4 text-sm">
	<dl class="ws-conn grid max-w-3xl grid-cols-[12rem_1fr] gap-x-6 gap-y-2">
		<dt class="opacity-60">URL</dt>
		<dd class="break-all font-mono">{url}</dd>
		<dt class="opacity-60">State</dt>
		<dd>
			<span class="chip text-xs {STATE_CHIPS[tone] ?? 'variant-soft'}"
				>{state || "unknown"}</span
			>
		</dd>
		<dt class="opacity-60">Close</dt>
		<dd
			class="font-mono {summary.closedByMarasi
				? 'text-warning-600 dark:text-warning-400'
				: ''}"
		>
			{summary.close}
		</dd>

		<dt class="col-span-2 mt-3 text-xs font-semibold uppercase opacity-60">
			Compression
		</dt>
		{#each summary.compression as row}
			<dt class="opacity-60">{row.label}</dt>
			<dd class:font-mono={row.value === "permessage-deflate"}>
				{row.value}
			</dd>
		{/each}
		{#if summary.compressionNote}
			<dd class="col-span-2 text-xs opacity-60">
				{summary.compressionNote}
			</dd>
		{/if}

		<dt class="col-span-2 mt-3 text-xs font-semibold uppercase opacity-60">
			Stripped by Marasi
		</dt>
		{#each summary.strippedOffers as offer}
			<dt class="opacity-60">Offer</dt>
			<dd class="font-mono">{offer}</dd>
		{:else}
			<dt class="opacity-60">Offer</dt>
			<dd>{summary.strippedNone}</dd>
		{/each}
	</dl>
</div>

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	@media (max-width: 40rem) {
		:global(html.mobile .ws-conn) {
			grid-template-columns: max-content minmax(0, 1fr);
			column-gap: 1rem;
			overflow-wrap: anywhere;
		}
	}
</style>
