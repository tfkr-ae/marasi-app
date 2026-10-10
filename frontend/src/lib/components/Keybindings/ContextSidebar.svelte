<script>
	// One entry per page and state, styled like Marasi menu items. Each ends
	// in a fixed-width count slot: conflicts, else unbound, else the number
	// of available actions (an entry listing only unavailable ones shows none).
	export let groups; // browse() groups
	export let selected; // group id
	export let onSelect; // (groupId) => void
</script>

<nav
	class="w-60 shrink-0 overflow-y-auto [scrollbar-gutter:stable] border-r border-surface-300 dark:border-surface-600"
	aria-label="Page and state"
>
	{#each groups as group (group.id)}
		<button
			type="button"
			class="flex w-full items-center justify-between border-l-4 px-3 py-2 text-left hover:bg-surface-200 dark:hover:bg-surface-700 {selected ===
			group.id
				? 'border-primary-500 bg-surface-200 dark:bg-surface-700'
				: 'border-transparent'}"
			aria-current={selected === group.id ? "true" : undefined}
			on:click={() => onSelect(group.id)}
		>
			<div class="flex min-w-0 flex-col">
				<span>{group.page}</span>
				<span class="text-sm opacity-70">{group.state}</span>
			</div>
			<span class="flex w-7 shrink-0 justify-center">
				{#if group.conflictCount}
					<span class="badge variant-filled-error" title="{group.conflictCount} conflicting">{group.conflictCount}</span>
				{:else if group.unboundCount}
					<span class="badge variant-filled-warning" title="{group.unboundCount} unbound">{group.unboundCount}</span>
				{:else if group.actionCount}
					<span class="text-sm opacity-50" title="{group.actionCount} actions">{group.actionCount}</span>
				{/if}
			</span>
		</button>
	{/each}
</nav>
