<script>
	// The streamed pair kind's read-only Pair tab: each direction's message
	// framing, message count, ending (with the reset code) and trailers,
	// kept current by the streamed_pair.* events (streamedPairStore).
	import { ArrowDownLeft, ArrowUpRight } from "lucide-svelte";
	import { canCancel, streamedPairStore } from "../../stores/streamedPairStore.js";
	import { directionArrow } from "./kinds.js";
	import { pairTrailers } from "./streamMessage.js";

	export let pairId;

	const DIRECTIONS = [
		{ id: "request", label: "Request" },
		{ id: "response", label: "Response" },
	];

	// Literal class strings so Tailwind's content scan keeps them.
	const ENDING_CHIPS = {
		live: "variant-soft-success",
		complete: "variant-soft-surface",
		cancelled: "variant-soft-error",
		reset: "variant-soft-error",
		"cut short": "variant-soft-error",
	};

	$: pair = $streamedPairStore.pairs[pairId];
	$: messages = pair?.messages ?? [];
	// A direction not known while the pair is live may still start: a
	// response whose head isn't admitted yet. A request's head comes first.
	$: live = Boolean(pair?.pair) && canCancel(pair.directions);

	function summary(id) {
		const d = pair?.directions[id];
		if (!d) return null;
		const loaded = messages.filter((m) => m.Direction === id).length;
		const ending = d.Ending ?? "live";
		return {
			framing: d.Framing,
			count: d.Messages ?? `${loaded}${pair.hasMore ? "+" : ""}`,
			ending,
			endingText: ending === "reset" && d.ResetCode ? `reset (${d.ResetCode})` : ending,
			trailers: d.Trailers?.length ? d.Trailers : pairTrailers(messages, id),
		};
	}

	$: rows = DIRECTIONS.map((direction) => ({ ...direction, summary: pair && summary(direction.id) }));
</script>

<div class="h-full overflow-auto p-4 text-sm">
	{#if pair?.pair}
		<p class="mb-3 break-all font-mono text-xs opacity-70">
			#{pair.pair.Number} · {pair.pair.Method} {pair.pair.Host}{pair.pair.Path}
		</p>
	{/if}
	<div class="stream-pair grid max-w-4xl grid-cols-2 gap-4">
		{#each rows as row (row.id)}
			{@const arrow = directionArrow(row.id === "request")}
			<section class="card variant-soft-surface rounded-none p-3" data-direction={row.id}>
				<h3 class="mb-2 flex items-center gap-1 text-sm font-bold">
					{#if arrow.up}<ArrowUpRight size={14} class={arrow.class} />{:else}<ArrowDownLeft
							size={14}
							class={arrow.class}
						/>{/if}
					{row.label}
				</h3>
				{#if row.summary}
					<dl class="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1 text-xs">
						<dt class="opacity-60">Framing</dt>
						<dd class="font-mono">{row.summary.framing}</dd>
						<dt class="opacity-60">Messages</dt>
						<dd>{row.summary.count}</dd>
						<dt class="opacity-60">Ending</dt>
						<dd>
							<span class="chip text-xs {ENDING_CHIPS[row.summary.ending] ?? 'variant-soft-surface'}"
								>{row.summary.endingText}</span
							>
						</dd>
						<dt class="opacity-60">Trailers</dt>
						<dd class="font-mono">
							{#each row.summary.trailers as trailer}
								<div class="break-all">{trailer.Name}: {trailer.Value}</div>
							{:else}
								<span class="opacity-60">None</span>
							{/each}
						</dd>
					</dl>
				{:else}
					<p class="text-xs opacity-60">{live && row.id === "response" ? "Not started" : "Not streamed"}</p>
				{/if}
			</section>
		{/each}
	</div>
</div>

<style>
	/* The mobile layout (html.mobile, lib/platform.js): one column. */
	@media (max-width: 40rem) {
		:global(html.mobile .stream-pair) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
