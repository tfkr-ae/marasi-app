<script>
	// Fixed-width count slot ending a sidebar entry: conflicts, else unbound,
	// else the number of available actions (none when there are only
	// unavailable ones), so plain numbers and badges line up.
	export let counts; // { conflictCount, unboundCount, actionCount }
</script>

<span class="flex w-7 shrink-0 justify-center">
	{#if counts.conflictCount}
		<span class="badge variant-filled-error text-3xs" title="{counts.conflictCount} conflicting">{counts.conflictCount}</span>
	{:else if counts.unboundCount}
		<span class="badge variant-filled-warning text-3xs" title="{counts.unboundCount} unbound">{counts.unboundCount}</span>
	{:else if counts.actionCount}
		<span class="text-3xs opacity-50" title="{counts.actionCount} actions">{counts.actionCount}</span>
	{/if}
</span>
