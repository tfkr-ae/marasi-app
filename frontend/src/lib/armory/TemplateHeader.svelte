<script>
	// The selected template's name and description, with Save and Delete.
	// The input and both buttons share one height.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Save, Trash2 } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";

	export let name = "";
	export let description = "";
	export let saving = false;
	export let onSave = () => {};
	export let onDelete = () => {};

	$: primary = primaryVariant($modeCurrent);
</script>

<header class="flex-none space-y-2 border-b border-surface-500/30 bg-surface-50 p-3 dark:bg-surface-900">
	<div class="flex h-8 items-center gap-2">
		<input class="input h-8 min-w-0 flex-1 py-1 text-sm font-bold" placeholder="Template name" bind:value={name} />
		<button type="button" class="btn btn-sm h-8 flex-none {primary}" disabled={saving} on:click={onSave}>
			<Save size={14} class="mr-1" />Save
		</button>
		<button
			type="button"
			class="btn btn-sm h-8 w-8 flex-none px-0 {primary}"
			title="Delete template"
			aria-label="Delete template"
			on:click={onDelete}
		>
			<Trash2 size={14} />
		</button>
	</div>
	<input class="input h-8 w-full py-1 text-xs" placeholder="Description" bind:value={description} />
</header>
