<script>
	// A card on a drawing, drawn by the app over the canvas as an Excalidraw
	// embeddable, in the app's own classes, so its colours are the Ledger's
	// and the Logbook's in either mode. It follows its source live: the
	// Logbook store for records, pairRowsStore for pairs.
	import { afterUpdate } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { highlightPalette } from "../../stores/highlightsStore.js";
	import { pairRows } from "../../stores/pairRowsStore.js";
	import { cardContent } from "./cardContent.js";

	/** { kind, id } */
	export let source;
	/** A pair's row when the card was added, for a pair not read yet. */
	export let last = null;
	/** True while an arrow being drawn would bind to this card. */
	export let suggested = false;
	export let onOpen = () => {};
	/** Called with the content's natural height, so the element can fit it. */
	export let onSize = (_height) => {};

	const same = (a, b) => String(a) === String(b);

	$: pairRow = source.kind === "pair" ? $pairRows[String(source.id)] : undefined;
	// A pair not read yet shows the row it carries; one read as gone, none.
	$: item =
		source.kind === "pair"
			? pairRow === undefined
				? last
				: pairRow
			: (source.kind === "finding" ? $logbookStore.findings : $logbookStore.testCases).find((r) =>
					same(r.ID, source.id),
				) ?? null;
	$: findingCount =
		source.kind === "testCase" ? $logbookStore.findings.filter((f) => same(f.TestCaseID, source.id)).length : 0;
	$: content = cardContent(source, item, { palette: $highlightPalette, light: $modeCurrent, findingCount });

	let inner;
	afterUpdate(() => {
		if (inner) onSize(inner.offsetHeight);
	});
</script>

<div
	class="marasi-card relative h-full w-full overflow-hidden rounded-none border bg-surface-50 text-surface-900 dark:bg-surface-800 dark:text-surface-50 {content.deleted
		? 'border-dashed border-surface-400'
		: 'border-surface-300 dark:border-surface-600'} {suggested ? 'ring-2 ring-primary-500' : ''}"
	data-testid="card"
	data-kind={source.kind}
	data-deleted={content.deleted || undefined}
	data-suggested={suggested || undefined}
>
	<span
		class="absolute bottom-0 left-0 top-0 w-1 {content.accent.classes ?? ''}"
		style={content.accent.color ? `background-color: ${content.accent.color}` : ""}
	></span>
	<div bind:this={inner} class="py-2.5 pl-4 pr-3">
		<div class="flex items-center text-3xs font-bold uppercase tracking-wider opacity-60">
			<span class="flex-1">{content.label}</span>
			<button
				type="button"
				class="pointer-events-auto rounded-none px-1 normal-case tracking-normal hover:bg-surface-500/20"
				title="Open in Marasi"
				data-testid="card-open"
				on:pointerdown|stopPropagation
				on:click|stopPropagation={onOpen}>Open ↗</button
			>
		</div>
		{#if content.chips.length}
			<div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
				{#each content.chips as chip}
					<span
						class="{chip.plain ? '' : 'badge rounded-none px-1.5 py-0.5'} {chip.mono ? 'font-mono tabular-nums' : ''} {chip.bold
							? 'font-bold'
							: ''} {chip.classes ?? ''}"
						style={chip.color ? `background-color: ${chip.color}; color: white` : ""}>{chip.text}</span
					>
				{/each}
			</div>
		{/if}
		<p
			class="mt-2 line-clamp-2 {content.title.mono
				? 'break-all font-mono text-sm font-semibold'
				: 'text-base font-semibold leading-snug'} {content.deleted ? 'opacity-60' : ''}"
			data-testid="card-title"
		>
			{content.title.text}
		</p>
		{#each content.lines as line}
			<p class="line-clamp-2 break-words text-xs opacity-60">{line.text}</p>
		{/each}
		{#if content.footer}
			<div class="mt-2 border-t border-surface-500/20 pt-1.5 text-2xs opacity-60">{content.footer}</div>
		{/if}
	</div>
</div>
