<script>
	// The From bar over CyberChef's input: the pair the open input tab came
	// from by Insert, with Req | Res and Body, which swap its text
	// (`onSwap({ part, bodyOnly })`). The app's own markup, outside CyberChef.
	import { onDestroy } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { pairRows } from "../../../stores/pairRowsStore.js";
	import { METHOD_CLASS, primaryVariant } from "../../launchpad/format.js";

	/** The open tab's source ({ pairId, part, bodyOnly }). */
	export let source;
	export let onSwap = (_want) => {};
	export let busy = false;

	// The pair's row, kept live, so Res turns on when its response arrives.
	let stop = () => {};
	let trackedId = null;
	$: if (source.pairId !== trackedId) {
		stop();
		trackedId = source.pairId;
		stop = pairRows.track([String(trackedId)]);
	}
	onDestroy(() => stop());

	$: row = $pairRows[String(source.pairId)];
	$: hasResponse = Number(row?.StatusCode) > 0;
	$: on = primaryVariant($modeCurrent);
	const chip = (active) => `whitespace-nowrap rounded-none px-2 py-0.5 ${active ? on : "opacity-70 hover:bg-surface-500/10"}`;
	const swap = (want) => onSwap({ part: source.part, bodyOnly: source.bodyOnly, ...want });
</script>

<div
	class="flex min-w-0 items-center gap-2 border-b border-surface-500/30 bg-surface-100 px-3 py-1 text-2xs dark:bg-surface-800"
	data-testid="cyberchef-source-bar"
>
	<span class="opacity-60">From</span>
	<span
		class="min-w-0 flex-1 truncate font-mono"
		title={row ? `${row.Method} ${row.Scheme ? `${row.Scheme}://` : ""}${row.Host ?? ""}${row.Path ?? ""}` : ""}
	>
		{#if row}
			<span class="opacity-60">#{row.Number}</span>
			<b class={METHOD_CLASS[row.Method] ?? ""}>{row.Method}</b>
			{row.Path}
		{:else if row === null}
			<span class="opacity-60">Pair deleted</span>
		{:else}
			<span class="opacity-60">Pair {source.pairId}</span>
		{/if}
	</span>
	<span class="flex shrink-0 border border-surface-500/30">
		<button
			type="button"
			class={chip(source.part === "request")}
			aria-pressed={source.part === "request"}
			disabled={busy}
			data-testid="cyberchef-source-req"
			on:click={() => swap({ part: "request" })}>Req</button
		>
		<button
			type="button"
			class={chip(source.part === "response")}
			aria-pressed={source.part === "response"}
			disabled={busy || !hasResponse}
			title={hasResponse ? "" : "No response yet"}
			data-testid="cyberchef-source-res"
			on:click={() => swap({ part: "response" })}>Res</button
		>
	</span>
	<button
		type="button"
		class="shrink-0 border border-surface-500/30 {chip(source.bodyOnly)}"
		aria-pressed={source.bodyOnly}
		disabled={busy}
		title="Only the body"
		data-testid="cyberchef-source-body"
		on:click={() => swap({ bodyOnly: !source.bodyOnly })}>Body</button
	>
</div>
