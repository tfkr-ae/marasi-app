<script>
	// Home's Pending column: one card per overviewOf pending item, coloured by
	// its tone, each doing its action or opening where you act; "All clear"
	// when nothing is pending.
	import { createEventDispatcher } from "svelte";
	import { Check, Flag, Power, Radio, TriangleAlert } from "lucide-svelte";
	export let items = [];
	const dispatch = createEventDispatcher();

	const icons = { listener: Power, held: Flag, "intercept-all": Radio, urgent: TriangleAlert };
	const swatch = (colour) =>
		`border-color: rgb(var(--color-${colour}-700)); --chip-bg: rgb(var(--color-${colour}-700)); --chip-fg: rgb(var(--color-${colour}-200))`;
</script>

<section data-testid="home-pending">
	<h3 class="text-sm font-bold mb-2">Pending</h3>
	{#if items.length}
		<ul class="space-y-2">
			{#each items as item (item.id)}
				<li>
					<button
						type="button"
						class="item card bg-surface-100-500-token text-surface-900-50-token border-l-4 w-full flex items-center gap-3 p-2 text-left"
						style={swatch(item.tone)}
						data-testid="home-pending-item"
						data-pending={item.id}
						on:click={() => dispatch("open", item.destination)}
					>
						<span class="chip-icon"><svelte:component this={icons[item.id] ?? TriangleAlert} size={14} /></span>
						<span class="flex-1 min-w-0">
							<span class="block text-xs font-bold">{item.title}</span>
							<span class="block text-2xs opacity-70">{item.detail}</span>
						</span>
						<span class="text-2xs opacity-70 shrink-0">{item.action} →</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4 flex items-center gap-3 p-2 text-xs font-bold"
			style={swatch("success")}
			data-testid="home-pending-clear"
		>
			<span class="chip-icon"><Check size={14} /></span>All clear
		</div>
	{/if}
</section>

<style>
	.chip-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		padding: 0.5rem;
		background: var(--chip-bg);
		color: var(--chip-fg);
	}
	.item:hover {
		background-color: rgb(var(--color-surface-500) / 0.12);
	}
</style>
