<script>
	// An outline section's grouping, picked from a small menu in its header.
	import { Check, ChevronDown } from "lucide-svelte";

	/** [[value, label]] */
	export let options = [];
	export let value;
	export let onChange = (value) => {};

	let open = false;
	let root;
	$: label = options.find(([v]) => v === value)?.[1] ?? "";

	function onWindowPointerDown(event) {
		if (open && root && !root.contains(event.target)) open = false;
	}
</script>

<svelte:window on:pointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
	class="relative"
	bind:this={root}
	on:keydown={(e) => {
		if (e.key === "Escape" && open) {
			e.stopPropagation();
			open = false;
		}
	}}
>
	<button
		class="flex items-center gap-0.5 font-normal opacity-70 hover:opacity-100"
		title="Group by"
		aria-haspopup="true"
		aria-expanded={open}
		on:click={() => (open = !open)}
	>
		{label}<ChevronDown size={11} />
	</button>
	{#if open}
		<div class="card absolute right-0 top-full z-40 mt-1 w-40 py-1 text-xs font-normal shadow-xl" role="menu">
			<div class="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider opacity-50">Group by</div>
			{#each options as [v, l]}
				<button
					class="flex h-8 w-full items-center gap-2 px-3 text-left hover:bg-surface-200-700-token"
					role="menuitemradio"
					aria-checked={v === value}
					on:click={() => {
						open = false;
						onChange(v);
					}}
				>
					<span class="w-3.5 flex-none">{#if v === value}<Check size={12} />{/if}</span>{l}
				</button>
			{/each}
		</div>
	{/if}
</div>
