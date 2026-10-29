<script>
	// Tags as compact chips with the input inline, at the fields' size.
	// Enter or comma adds; Backspace on an empty input removes the last.
	import { createEventDispatcher } from "svelte";
	import { X } from "lucide-svelte";

	export let tags = [];
	const dispatch = createEventDispatcher();
	let value = "";

	const set = (next) => dispatch("change", next);

	function add() {
		const tag = value.trim().replace(/,+$/, "").trim();
		value = "";
		if (tag && !tags.includes(tag)) set([...tags, tag]);
	}

	function onKey(event) {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			add();
		} else if (event.key === "Backspace" && !value && tags.length) {
			set(tags.slice(0, -1));
		}
	}
</script>

<div class="flex min-h-8 flex-wrap items-center gap-1 rounded-token bg-surface-200-700-token px-1.5 py-1 focus-within:ring-1 focus-within:ring-primary-500/60" data-field="Tags">
	{#each tags as tag (tag)}
		<span class="flex items-center gap-1 rounded-sm bg-tertiary-500/20 px-1.5 py-0.5 text-2xs">
			{tag}
			<button type="button" class="opacity-60 hover:opacity-100" title="Remove {tag}" aria-label="Remove {tag}" on:click={() => set(tags.filter((t) => t !== tag))}><X size={10} /></button>
		</span>
	{/each}
	<input
		class="h-6 min-w-[6rem] flex-1 border-0 bg-transparent p-0 px-1 text-xs placeholder:opacity-60 focus:ring-0"
		placeholder={tags.length ? "" : "Add a tag"}
		bind:value
		on:keydown={onKey}
		on:blur={add}
	/>
</div>
