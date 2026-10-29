<script>
	// A Logbook toolbar menu's panel: options to tick, each with a count,
	// and Clear once any is ticked.
	import { Check } from "lucide-svelte";

	/** [{ value, label, count, mark? }], mark a colour class for a square. */
	export let options = [];
	export let selected = [];
	export let mono = false;
	export let onChange = (next) => {};

	const pick = (value) =>
		onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
</script>

<div class="py-1 text-xs">
	{#each options as option (option.value)}
		{@const on = selected.includes(option.value)}
		<button
			class="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-surface-200-700-token"
			aria-pressed={on}
			on:click={() => pick(option.value)}
		>
			<span
				class="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-sm ring-1 {on
					? 'bg-primary-500 text-white ring-primary-500'
					: 'ring-surface-500/50'}">{#if on}<Check size={10} />{/if}</span
			>
			{#if option.mark}<span class="h-2.5 w-2.5 flex-none rounded-sm {option.mark}"></span>{/if}
			<span class="min-w-0 flex-1 truncate {mono ? 'font-mono text-2xs' : ''}">{option.label ?? option.value}</span>
			<span class="text-2xs tabular-nums opacity-50">{option.count}</span>
		</button>
	{:else}
		<p class="px-3 py-2 text-2xs opacity-60">None yet</p>
	{/each}
	{#if selected.length}
		<button
			class="mt-1 w-full border-t border-surface-500/20 px-3 py-2 text-left text-2xs opacity-70 hover:opacity-100"
			on:click={() => onChange([])}>Clear</button
		>
	{/if}
</div>
