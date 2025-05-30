<script>
	export let handler;
	export let orderBy;

	const sorted = handler.getSort();
	const identifier = orderBy.toString()
</script>


<th on:click={() => handler.sort(orderBy)} class="cursor-pointer select-none">
	<div class="flex h-full items-center justify-start gap-x-2">
		<slot />
		{#if $sorted.identifier === identifier}
			{#if $sorted.direction === 'asc'}
			&uarr;
			{:else if $sorted.direction === 'desc'}
			&darr;
			{/if}
		{:else}
			&updownarrow;
		{/if}
	</div>
</th>