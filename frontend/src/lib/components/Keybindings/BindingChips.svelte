<script>
	// One action's bindings as removable key chips (click a chip to record a
	// replacement), then Add binding and Reset in fixed positions so every
	// row's buttons line up.
	import { Plus, RotateCcw, X } from "lucide-svelte";

	export let row;
	export let disabled = false;
	export let onRecord; // (index?) => void; no index adds an alternative
	export let onRemove; // (index) => void
	export let onReset; // () => void

	const iconButton = "btn h-8 w-8 shrink-0 p-0 variant-soft-primary !border-0 !ring-0";
</script>

<div class="flex shrink-0 items-center justify-end gap-2">
	<div class="flex flex-wrap items-center justify-end gap-1">
		{#each row.display as key, index}
			<span class="kbd inline-flex items-center gap-0 rounded-none p-0 text-sm">
				<button
					type="button"
					class="px-2 py-0.5 hover:text-primary-500"
					{disabled}
					title="Record a replacement"
					on:click={() => onRecord(index)}>{key}</button
				>
				<button
					type="button"
					class="px-1 py-0.5 opacity-60 hover:text-error-500 hover:opacity-100"
					{disabled}
					title="Remove"
					aria-label="Remove {key} from {row.action.label}"
					on:click={() => onRemove(index)}><X size={12} /></button
				>
			</span>
		{/each}
	</div>
	<button
		type="button"
		class={iconButton}
		{disabled}
		title="Add binding"
		aria-label="Add binding to {row.action.label}"
		on:click={() => onRecord()}><Plus size={16} /></button
	>
	<button
		type="button"
		class={iconButton}
		disabled={disabled || !row.customized}
		title={row.available === false ? row.note : row.customized ? "Reset to default" : "Already the default"}
		aria-label="Reset {row.action.label}"
		on:click={onReset}><RotateCcw size={16} /></button
	>
</div>
