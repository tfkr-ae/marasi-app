<svelte:options immutable />

<script>
	// One row of the Messages modal's table (MessagesTable.svelte). It is
	// immutable: it redraws only when its message, number or selection
	// changes, so a live message adds a row without redrawing the others.
	import { ArrowDownLeft, ArrowUpRight } from "lucide-svelte";
	import { directionArrow } from "./kinds.js";

	export let message;
	export let number;
	export let selected = false;
	/** The kind's columns after # and Dir; the last one truncates. */
	export let columns = [];
	export let rowClass = () => "";
	export let rowTitle = () => "";
	export let isInjected = () => false;
	export let isOutgoing = () => true;
	export let rowChips = () => [];
	export let onSelect = () => {};

	$: arrow = directionArrow(isOutgoing(message));
	$: last = columns.length - 1;
</script>

<tr
	class="cursor-pointer {selected
		? 'bg-surface-500/20 outline outline-1 outline-offset-[-1px] outline-primary-500'
		: ''} {rowClass(message)}"
	title={rowTitle(message)}
	on:click={() => onSelect(message)}
>
	<td class="overflow-hidden whitespace-nowrap">{number}</td>
	<td class="overflow-hidden whitespace-nowrap">
		{#if arrow.up}
			<ArrowUpRight size={14} class={arrow.class} />
		{:else}
			<ArrowDownLeft size={14} class={arrow.class} />
		{/if}
	</td>
	{#each columns as column, i (column.id)}
		<td class="overflow-hidden" class:whitespace-nowrap={i !== last}>
			{#if i === last}
				<div class="flex min-w-0 items-center gap-1">
					{#each rowChips(message) as chip (chip.label)}
						<span class="chip shrink-0 !px-1 !py-0 text-3xs {chip.class}" title={chip.title ?? ""}>{chip.label}</span>
					{/each}
					<div class="min-w-0 truncate" class:text-tertiary-500={isInjected(message)}>{column.cell(message)}</div>
				</div>
			{:else}
				{column.cell(message)}
			{/if}
		</td>
	{/each}
</tr>
