<script>
	// Shared highlight swatch radiogroup used in the command strip popover,
	// expanded left details column, and narrow-mobile left details sidebar.
	import { createEventDispatcher } from "svelte";
	import { X } from "lucide-svelte";
	import { highlightSwatchTitle } from "./drawerPresentation.js";

	/** The highlight palette, [{ number, label, color }]. */
	export let palette = [];
	/** Active highlight number on the focused pair, or null/undefined. */
	export let selected = null;
	/** "default" (h-3.5 w-3.5) for desktop, "touch" (h-4 w-4) for mobile sidebar. */
	export let size = "default";
	/** "column" for surface-900 dark panels, "popover" for surface-800 popovers. */
	export let surface = "column";
	/** Whether to append a clear-highlight button when a highlight is active. */
	export let showClear = false;
	/** Resolved active highlight colour (controls clear button visibility). */
	export let hasHighlight = false;
	let className = "";
	export { className as class };

	const dispatch = createEventDispatcher();

	$: ringOffset =
		surface === "popover"
			? "ring-offset-surface-50 dark:ring-offset-surface-800"
			: "ring-offset-surface-50 dark:ring-offset-surface-900";
</script>

<div class={className} role="radiogroup" aria-label="Highlight">
	{#each palette as h (h.number)}
		<button
			type="button"
			class="{size === 'touch' ? 'h-4 w-4' : 'h-3.5 w-3.5'} rounded-full {selected === h.number
				? `ring-2 ring-surface-900 ring-offset-1 dark:ring-surface-50 ${ringOffset}`
				: ''}"
			style="background: {h.color}"
			role="radio"
			aria-checked={selected === h.number}
			title={highlightSwatchTitle(h, selected)}
			aria-label={h.label}
			data-highlight={h.number}
			on:click={() => dispatch("highlight", selected === h.number ? null : h.number)}
		></button>
	{/each}
	{#if showClear && hasHighlight}
		<div class="h-3.5 w-px bg-surface-300-600-token" aria-hidden="true"></div>
		<button
			type="button"
			class="flex h-4 w-4 items-center justify-center opacity-60 hover:bg-surface-200-700-token hover:opacity-100"
			title="Clear highlight"
			aria-label="Clear highlight"
			on:click={() => dispatch("highlight", null)}
		>
			<X size={11} />
		</button>
	{/if}
</div>
