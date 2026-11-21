<script>
	// Switch Recipe: the project's recipes, filtered as you type. ↑ and ↓
	// move, ↩ opens, Esc closes.
	import { createEventDispatcher, onMount } from "svelte";

	/** [{ id, name }] */
	export let items = [];
	export let currentId = null;

	const dispatch = createEventDispatcher();
	let query = "";
	let field;
	$: matches = items.filter((recipe) => recipe.name.toLowerCase().includes(query.trim().toLowerCase()));
	let at = Math.max(0, items.findIndex((recipe) => recipe.id === currentId));
	$: at = Math.min(at, Math.max(matches.length - 1, 0));

	function onKeydown(event) {
		if (event.key === "ArrowDown") at = Math.min(at + 1, matches.length - 1);
		else if (event.key === "ArrowUp") at = Math.max(at - 1, 0);
		else if (event.key === "Enter" && matches[at]) dispatch("open", matches[at].id);
		else if (event.key === "Escape") dispatch("close");
		else return;
		event.preventDefault();
		event.stopPropagation();
	}

	onMount(() => field?.focus());
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="absolute inset-0 z-30 flex justify-center bg-surface-900/30 pt-16" on:click|self={() => dispatch("close")}>
	<div class="flex max-h-80 w-80 flex-col border border-surface-500/30 bg-surface-50 text-xs shadow-xl dark:bg-surface-800" data-testid="recipe-picker">
		<input
			bind:this={field}
			bind:value={query}
			class="input border-0 border-b border-surface-500/30 px-3 py-2 text-xs"
			placeholder="Switch recipe"
			aria-label="Switch recipe"
			on:keydown={onKeydown}
		/>
		<ul class="overflow-y-auto py-1" role="listbox" aria-label="Recipes">
			{#each matches as recipe, index (recipe.id)}
				<li role="option" aria-selected={index === at}>
					<button
						type="button"
						class="w-full truncate px-3 py-1.5 text-left {index === at ? 'bg-primary-500/20' : 'hover:bg-surface-500/15'} {recipe.id === currentId ? 'font-semibold' : ''}"
						on:mouseenter={() => (at = index)}
						on:click={() => dispatch("open", recipe.id)}
					>
						{recipe.name}
					</button>
				</li>
			{:else}
				<li class="px-3 py-1.5 opacity-60">No recipe matches</li>
			{/each}
		</ul>
	</div>
</div>
