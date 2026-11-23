<script>
	// A card on a drawing, drawn by the app over the canvas as an Excalidraw
	// embeddable, in the app's own classes, so its colours are the Ledger's
	// and the Logbook's in either mode. It follows its source live: the
	// Logbook store for records, pairRowsStore for pairs.
	// Its text is the page's (text-token), as the Ledger and Logbook inherit
	// it, so a GET or a title is the colour they draw it.
	import { afterUpdate } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { highlightPalette } from "../../stores/highlightsStore.js";
	import { pairRows } from "../../stores/pairRowsStore.js";
	import { pairRaw } from "../../stores/pairRawStore.js";
	import { METHOD_CLASS, primaryVariant, statusClass } from "../launchpad/format.js";
	import { cardContent } from "./cardContent.js";
	import { DEFAULT_VIEW, PART_NAMES } from "./cards.js";

	/** { kind, id } */
	export let source;
	/** A pair's row when the card was added, for a pair not read yet. */
	export let last = null;
	/** A pair card's view (cards.js cardView): { part, expanded }. */
	export let view = DEFAULT_VIEW;
	/** Called with a change to the view: { part } from the switch, { expanded } from the Details row. */
	export let onView = (_change) => {};
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
	// A pair card reads its raw messages for its first lines, and again
	// when its row shows a response that arrived after the read.
	$: if (source.kind === "pair" && item) pairRaw.need(source.id, item);
	$: raw = source.kind === "pair" ? ($pairRaw[String(source.id)] ?? undefined) : undefined;
	$: content = cardContent(source, item, {
		palette: $highlightPalette,
		light: $modeCurrent,
		findingCount,
		view,
		raw,
	});

	const SWITCH = [
		["request", "REQ"],
		["both", "BOTH"],
		["response", "RES"],
	];
	$: primary = primaryVariant($modeCurrent);

	// A start line's words: a request's method and a response's status in
	// their Ledger colours.
	function startWords(text, part) {
		const words = text.split(" ");
		if (part === "response") {
			return [
				{ text: words[0], classes: "opacity-60" },
				{ text: words.slice(1).join(" "), classes: statusClass(Number(words[1])) },
			];
		}
		return [
			{ text: words[0], classes: METHOD_CLASS[words[0]] ?? "" },
			{ text: words.slice(1, -1).join(" "), classes: "" },
			{ text: words.length > 1 ? words.at(-1) : "", classes: "opacity-50" },
		];
	}

	let inner;
	afterUpdate(() => {
		// An expanded card waiting for its messages keeps its height, so it
		// doesn't shrink and then grow again, pushing the cards under it.
		if (!inner || (content.expanded && !content.details)) return;
		onSize(inner.offsetHeight);
	});
</script>

<div
	class="marasi-card relative h-full w-full overflow-hidden rounded-none border bg-surface-50 text-token dark:bg-surface-800 {content.deleted
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
			{#if content.parts}
				<span class="pointer-events-auto mr-1 flex border border-surface-500/30 normal-case tracking-normal" data-testid="card-part">
					{#each SWITCH as [value, text]}
						<button
							type="button"
							class="rounded-none px-1.5 py-px {content.part === value
								? primary
								: 'hover:bg-surface-500/20 disabled:opacity-40 disabled:hover:bg-transparent'}"
							title={PART_NAMES[value]}
							aria-pressed={content.part === value}
							disabled={value !== "request" && !content.hasResponse}
							data-part={value}
							on:pointerdown|stopPropagation
							on:click|stopPropagation={() => content.part !== value && onView({ part: value })}>{text}</button
						>
					{/each}
				</span>
			{/if}
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
		{#if content.details}
			{#each content.details as detail}
				<div class="mt-1.5 border border-surface-500/20" data-testid="card-detail" data-part={detail.part}>
					<div class="bg-surface-200/60 px-2 py-0.5 text-3xs font-bold uppercase tracking-wider opacity-70 dark:bg-surface-700/60">
						{detail.title}
					</div>
					{#if detail.empty}
						<p class="px-2 py-1.5 text-2xs italic opacity-60">{detail.empty}</p>
					{:else}
						<!-- Each line wraps within the card's width; a long token breaks anywhere. -->
						<div class="px-2 py-1.5 font-mono text-2xs leading-snug [overflow-wrap:anywhere]">
							{#each detail.lines as line}
								{#if line.kind === "start"}
									<div class="whitespace-pre-wrap font-semibold">{#each startWords(line.text, detail.part) as word, i}{#if word.text}{i ? " " : ""}<span class={word.classes}>{word.text}</span>{/if}{/each}</div>
								{:else if line.kind === "header" && line.name}
									<div class="whitespace-pre-wrap"><span class="text-primary-700 dark:text-primary-400">{line.name}:</span><span class="opacity-75">{line.text.slice(line.name.length + 1)}</span></div>
								{:else if line.kind === "gap"}
									<div class="my-1.5 border-t border-surface-500/20"></div>
								{:else if line.kind === "more"}
									<div class="mt-1 text-3xs italic opacity-50">{line.text}</div>
								{:else}
									<div class="min-h-[1lh] whitespace-pre-wrap">{line.text}</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{:else if content.firstLines?.length}
			<div class="mt-1.5 space-y-0.5 font-mono text-2xs opacity-70" data-testid="card-first-lines">
				{#each content.firstLines as line}
					<p class="truncate" data-part={line.part}>{line.part === "request" ? "→" : "←"} {line.text}</p>
				{/each}
			</div>
		{/if}
		{#if content.footer}
			<div class="mt-2 border-t border-surface-500/20 pt-1.5 text-2xs opacity-60">{content.footer}</div>
		{/if}
		{#if content.parts}
			<button
				type="button"
				class="pointer-events-auto mt-1.5 flex w-full items-center rounded-none border-t border-surface-500/20 pt-1.5 text-2xs opacity-70 hover:opacity-100"
				aria-expanded={content.expanded}
				data-testid="card-details"
				on:pointerdown|stopPropagation
				on:click|stopPropagation={() => onView({ expanded: !content.expanded })}
				>{content.expanded ? "Hide details ▴" : "Details ▾"}</button
			>
		{/if}
	</div>
</div>
