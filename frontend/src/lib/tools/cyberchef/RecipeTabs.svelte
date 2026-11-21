<script>
	// The CyberChef page's tab strip: one tab per Recipe. Click to switch,
	// double-click to rename, × to delete, "+" for a new recipe, and a
	// paperclip on a recipe with Artifacts. Duplicate, Insert and Attach sit
	// on the right.
	import { createEventDispatcher } from "svelte";
	import { Copy, Paperclip, Plus, X } from "lucide-svelte";

	/** [{ id, name, attached }] */
	export let items = [];
	export let currentId = null;
	/** Insert and Attach arrive with issue 04; until then they are off. */
	export let canInsert = false;
	export let canAttach = false;

	const dispatch = createEventDispatcher();
	const hasArtifacts = (recipe) => Object.keys(recipe.attached ?? {}).length > 0;
</script>

<div
	class="flex items-center gap-1 border-b border-surface-500/20 bg-surface-100 px-2 py-1 text-xs dark:bg-surface-900"
	data-testid="recipe-tabs"
>
	<div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Recipes">
		{#each items as recipe (recipe.id)}
			<div
				class="group flex shrink-0 items-center gap-1 px-2 py-1 {recipe.id === currentId
					? 'bg-surface-300 font-semibold dark:bg-surface-700'
					: 'opacity-70 hover:opacity-100'}"
				data-testid="recipe-tab"
			>
				<button
					type="button"
					role="tab"
					aria-selected={recipe.id === currentId}
					class="max-w-[12rem] truncate"
					title={recipe.name}
					on:click={() => recipe.id !== currentId && dispatch("open", recipe.id)}
					on:dblclick={() => dispatch("rename", recipe.id)}
				>
					{recipe.name}
				</button>
				{#if hasArtifacts(recipe)}
					<span title="Attached as an Artifact" data-testid="recipe-attached"><Paperclip size="11" class="opacity-60" /></span>
				{/if}
				<button
					type="button"
					class="opacity-0 group-hover:opacity-70 focus:opacity-70"
					title="Delete {recipe.name}"
					aria-label="Delete {recipe.name}"
					on:click={() => dispatch("delete", recipe.id)}
				>
					<X size="12" />
				</button>
			</div>
		{/each}
		<button type="button" class="p-1 opacity-70 hover:opacity-100" title="New recipe" aria-label="New recipe" on:click={() => dispatch("create")}>
			<Plus size="14" />
		</button>
	</div>
	<button type="button" class="flex items-center gap-1 px-2 py-1 hover:bg-surface-500/20" title="Duplicate the open recipe" on:click={() => dispatch("duplicate")}>
		<Copy size="12" /> Duplicate
	</button>
	<button type="button" class="px-2 py-1 hover:bg-surface-500/20 disabled:opacity-40" disabled={!canInsert} on:click={() => dispatch("insert")}>Insert</button>
	<button type="button" class="px-2 py-1 hover:bg-surface-500/20 disabled:opacity-40" disabled={!canAttach} on:click={() => dispatch("attach")}>Attach…</button>
</div>
