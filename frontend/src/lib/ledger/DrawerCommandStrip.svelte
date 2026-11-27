<script>
	// Full-width top command strip for the Ledger drawer: optional far-left and
	// far-right corner slots (for split rail toggles), inline highlight swatch
	// picker, focused pair summary, quick-copy cluster, and drawer window
	// controls. All pair actions route through the drawer's existing action
	// handlers and active keymap.
	import { createEventDispatcher } from "svelte";
	import {
		ChevronDown,
		ChevronUp,
		Copy,
		FileOutput,
		Globe,
		Highlighter,
		Link,
		Maximize2,
		Minimize2,
		Radio,
		X,
	} from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import {
		DRAWER_CONTEXT,
		commandStripCopyActions,
		pairSummary,
		shortcutTooltip,
	} from "./drawerPresentation.js";

	/** The focused pair's table row. */
	export let pair;
	/** Its pair number in the project. */
	export let number = "";
	/** Live incoming response if it arrived after selection. */
	export let incomingResponse = null;
	/** Loaded response text, when available. */
	export let responseBody = "";
	export let maximised = false;
	/** Active highlight colour, or null. */
	export let highlight = null;
	/** The highlight palette, [{ number, label, color }]. */
	export let palette = [];
	/** Whether the pair is a WebSocket upgrade or streamed pair. */
	export let canOpenStream = false;
	/** Narrow mobile (<= 40rem) one-line strip without highlight picker or copy cluster. */
	export let compact = false;

	const dispatch = createEventDispatcher();
	const ICONS = {
		radio: Radio,
		copy: Copy,
		"file-output": FileOutput,
		link: Link,
		globe: Globe,
	};

	let highlightMenu = false;
	let highlightBox;
	let lastPairId = null;
	$: if (pair?.ID !== lastPairId) {
		lastPairId = pair?.ID ?? null;
		highlightMenu = false;
	}
	$: if (compact) highlightMenu = false;

	$: keymap = $menuDispatcher;
	$: summary = pairSummary(pair, { number, incomingResponse, responseBody });
	$: copyActions = commandStripCopyActions({ hasResponse: summary.hasResponse, canOpenStream });
	$: maximiseLabel = maximised ? "Restore the table" : "Maximise the drawer";

	const run = (actionId) => dispatch("action", actionId);
	const highlightTitle = (h) => (pair?.Highlight === h.number ? `${h.label} (click to clear)` : h.label);

	function pickHighlight(value) {
		dispatch("highlight", value);
		highlightMenu = false;
	}

	function onWindowPointerdown(event) {
		if (!highlightMenu) return;
		if (highlightBox && !highlightBox.contains(event.target)) {
			highlightMenu = false;
		}
	}

	function onWindowKeydown(event) {
		if (highlightMenu && event.key === "Escape") {
			event.preventDefault();
			event.stopImmediatePropagation();
			highlightMenu = false;
		}
	}

	const topBtn =
		"inline-flex h-6 items-center gap-1 px-1.5 text-2xs hover:bg-surface-200-700-token disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";
	const winBtn = "flex h-6 w-6 flex-none items-center justify-center hover:bg-surface-200-700-token";
</script>

<svelte:window on:pointerdown={onWindowPointerdown} on:keydown={onWindowKeydown} />

<header
	class="ledger-drawer-command-strip relative flex h-8 flex-none items-center border-b border-surface-300-600-token bg-surface-100 dark:bg-surface-800 {compact
		? 'gap-1 px-1'
		: 'gap-1.5 px-1.5'}"
>
	{#if $$slots["left-corner"]}
		<slot name="left-corner" />
		{#if !compact}
			<div class="h-4 w-px flex-none bg-surface-300-600-token" aria-hidden="true"></div>
		{/if}
	{/if}

	{#if !compact}
		<div class="relative flex-none" bind:this={highlightBox}>
			<button
				type="button"
				class="ledger-drawer-highlight-trigger flex h-5 w-5 items-center justify-center hover:bg-surface-200-700-token"
				title={highlight ? "Change highlight" : "Set highlight"}
				aria-label={highlight ? "Change highlight" : "Set highlight"}
				aria-expanded={highlightMenu}
				aria-haspopup="true"
				on:click={() => (highlightMenu = !highlightMenu)}
			>
				{#if highlight}
					<span class="h-2.5 w-2.5 rounded-full" style="background: {highlight}"></span>
				{:else}
					<Highlighter size={12} class="opacity-60" />
				{/if}
			</button>

			{#if highlightMenu}
				<div
					class="ledger-drawer-highlight-popover absolute left-0 top-full z-50 mt-1 flex items-center gap-1.5 border border-surface-300-600-token bg-surface-50 px-2.5 py-1.5 shadow-xl dark:bg-surface-800"
					role="radiogroup"
					aria-label="Highlight"
				>
					{#each palette as h (h.number)}
						<button
							type="button"
							class="h-3.5 w-3.5 rounded-full {pair?.Highlight === h.number
								? 'ring-2 ring-surface-900 ring-offset-1 ring-offset-surface-50 dark:ring-surface-50 dark:ring-offset-surface-800'
								: ''}"
							style="background: {h.color}"
							role="radio"
							aria-checked={pair?.Highlight === h.number}
							title={highlightTitle(h)}
							aria-label={h.label}
							data-highlight={h.number}
							on:click={() => pickHighlight(pair?.Highlight === h.number ? null : h.number)}
						></button>
					{/each}
					{#if highlight}
						<div class="h-3.5 w-px bg-surface-300-600-token" aria-hidden="true"></div>
						<button
							type="button"
							class="flex h-4 w-4 items-center justify-center opacity-60 hover:bg-surface-200-700-token hover:opacity-100"
							title="Clear highlight"
							aria-label="Clear highlight"
							on:click={() => pickHighlight(null)}
						>
							<X size={11} />
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<div class="ledger-drawer-summary flex min-w-0 flex-1 items-center gap-1.5 font-mono text-2xs">
		{#if summary.number}
			<span class="flex-none opacity-50">#{summary.number}</span>
		{/if}
		<span class="flex-none font-bold {summary.methodClass}">{summary.method}</span>
		<span class="flex-none font-semibold {summary.statusClass}"
			>{compact && summary.statusCode <= 0 ? "…" : summary.status}</span
		>
		{#if compact}
			<span class="min-w-0 flex-1 truncate opacity-75" title={summary.fullUrl}>{summary.path}</span>
		{:else}
			<span class="min-w-0 truncate" title={summary.fullUrl}>
				<span class="opacity-60">{summary.host}</span><span>{summary.path}</span>
			</span>
			{#if summary.timing}
				<span class="hidden flex-none opacity-55 lg:inline">· {summary.timing}</span>
			{/if}
			{#if summary.protocol}
				<span class="hidden flex-none opacity-50 xl:inline" title={summary.protocolTitle}>· {summary.protocol}</span>
			{/if}
		{/if}
	</div>

	{#if !compact}
		<div class="ledger-drawer-copy-cluster flex flex-none items-center gap-0.5 border-l border-surface-300-600-token pl-1.5">
			{#each copyActions as action (action.id)}
				<button
					type="button"
					class="{topBtn} {action.accent ? 'font-medium text-success-500' : ''}"
					disabled={action.disabled}
					title={action.disabled && action.disabledHint
						? action.disabledHint
						: shortcutTooltip(action.label, action.actionId, keymap)}
					aria-label={action.label}
					on:click={() => run(action.actionId)}
				>
					<svelte:component this={ICONS[action.icon]} size={12} />
					{#if action.shortLabel}
						<span class={action.accent ? "hidden lg:inline" : "hidden md:inline"}>{action.shortLabel}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<div
		class="ledger-drawer-window-controls flex flex-none items-center {compact
			? 'gap-0'
			: 'gap-0.5 border-l border-surface-300-600-token pl-1.5'}"
	>
		<button
			type="button"
			class={winBtn}
			title={shortcutTooltip("Previous request", `${DRAWER_CONTEXT}.previous-request`, keymap)}
			aria-label="Previous request"
			on:click={() => dispatch("step", -1)}
		>
			<ChevronUp size={14} />
		</button>
		<button
			type="button"
			class={winBtn}
			title={shortcutTooltip("Next request", `${DRAWER_CONTEXT}.next-request`, keymap)}
			aria-label="Next request"
			on:click={() => dispatch("step", 1)}
		>
			<ChevronDown size={14} />
		</button>
		<button
			type="button"
			class={winBtn}
			title={shortcutTooltip(maximiseLabel, `${DRAWER_CONTEXT}.toggle-fullscreen`, keymap)}
			aria-label={maximiseLabel}
			aria-pressed={maximised}
			on:click={() => dispatch("maximise")}
		>
			{#if maximised}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
		</button>
		<button
			type="button"
			class={winBtn}
			title="Close (Esc)"
			aria-label="Close the drawer"
			on:click={() => dispatch("close")}
		>
			<X size={14} />
		</button>
	</div>

	{#if $$slots["right-corner"]}
		{#if !compact}
			<div class="h-4 w-px flex-none bg-surface-300-600-token" aria-hidden="true"></div>
		{/if}
		<slot name="right-corner" />
	{/if}
</header>
