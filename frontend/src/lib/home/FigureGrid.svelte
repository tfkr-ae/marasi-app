<script>
	// Home's figures: one tile per overviewOf figure, in the original Home's
	// colours (a 4px left border and an icon square in the 700 shade), each
	// opening the page that lists what it counts.
	import { createEventDispatcher } from "svelte";
	import { Activity, ArrowUpRight, BookCheck, Flag, Pencil, Send, Shield, ShieldOff, Swords } from "lucide-svelte";
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
	const swatch = ({ colour, glyph = 200 }) =>
		`border-color: rgb(var(--color-${colour}-700)); --chip-bg: rgb(var(--color-${colour}-700)); --chip-fg: rgb(var(--color-${colour}-${glyph}))`;
</script>

<div class="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="home-figures">
	{#each figures as figure (figure.id)}
		<button
			type="button"
			class="tile card bg-surface-100-500-token text-surface-900-50-token border-l-4 p-3 flex items-center gap-3 text-left"
			style={swatch(figure)}
			data-testid="home-figure"
			data-figure={figure.id}
			on:click={() => dispatch("open", figure.destination)}
		>
			<span class="chip-icon">
				<svelte:component this={iconOf(figure)} size={16} />
			</span>
			<span class="flex-1 min-w-0">
				<span class="flex justify-between text-2xs opacity-70">{figure.label}<ArrowUpRight size={12} /></span>
				<span class="block text-base font-bold" data-testid="home-figure-value">
					{#if figure.value === null}<span class="ghost inline-block h-5 w-12 animate-pulse bg-surface-300 align-middle dark:bg-surface-600"></span>{:else}{figure.value}{/if}
				</span>
				{#if figure.sub}
					<span
						class="block text-2xs opacity-70 truncate"
						title={figure.floor ? "Marasi is still counting intercepted requests from before this version" : undefined}
						>{figure.sub}</span
					>
				{/if}
			</span>
		</button>
	{/each}
</div>

<style>
	.chip-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		padding: 0.5rem;
		background: var(--chip-bg);
		color: var(--chip-fg);
	}
	.tile:hover {
		background-color: rgb(var(--color-surface-500) / 0.12);
	}
</style>
