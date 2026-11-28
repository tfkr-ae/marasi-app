<script>
	// Home's figures: one tile per overviewOf figure, in the original Home's
	// colours (a 4px left border and an icon square in the 700 shade), each
	// opening the page that lists what it counts.
	import { createEventDispatcher } from "svelte";
	import { Activity, ArrowUpRight, BookCheck, Flag, Pencil, Send, Shield, ShieldOff, Swords } from "lucide-svelte";
	import ChipIcon from "./ChipIcon.svelte";
	import { swatch } from "./swatch.js";
	export let figures = [];
	const dispatch = createEventDispatcher();

	const icons = {
		pairs: Activity,
		intercepted: Flag,
		notes: Pencil,
		launchpads: Send,
		held: Flag,
		armory: Swords,
		"test-cases": BookCheck,
	};
	// Scope's icon follows its default: a shield for Deny, crossed for Allow.
	const iconOf = (figure) => (figure.id === "scope" ? (figure.value === "Deny" ? Shield : ShieldOff) : icons[figure.id]);
</script>

<div class="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="home-figures">
	{#each figures as figure (figure.id)}
		<button
			type="button"
			class="action-card card bg-surface-100-500-token text-surface-900-50-token border-l-4 p-3 flex items-center gap-3 text-left"
			style={swatch(figure.colour, figure.glyph)}
			data-testid="home-figure"
			data-figure={figure.id}
			on:click={() => dispatch("open", figure.destination)}
		>
			<ChipIcon><svelte:component this={iconOf(figure)} size={16} /></ChipIcon>
			<span class="flex-1 min-w-0">
				<span class="flex justify-between text-2xs opacity-70">{figure.label}<ArrowUpRight size={12} /></span>
				<span class="block text-base font-bold" data-testid="home-figure-value">
					{#if figure.value === null}<span class="ghost inline-block h-5 w-12 animate-pulse bg-surface-300 align-middle dark:bg-surface-600"></span>{:else}{figure.value}{/if}
				</span>
				{#if figure.sub}
					<span
						class="block text-2xs opacity-70 truncate"
						title={figure.floor ? "Still counting older pairs" : undefined}
						>{figure.sub}</span
					>
				{/if}
			</span>
		</button>
	{/each}
</div>

