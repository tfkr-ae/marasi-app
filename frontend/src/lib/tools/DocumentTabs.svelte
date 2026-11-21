<script>
	// A tool page's tab strip over one toolDocuments collection: click a tab
	// to open it, double-click to rename, × to delete, + for a new one. A
	// document with Artifacts shows a paperclip. The page's own buttons
	// (Insert, Attach…) go in the default slot, on the right.
	import { Paperclip, Plus, X } from "lucide-svelte";

	/** A toolDocuments collection (toolDocuments.js). */
	export let documents;
	/** "drawing" or "recipe", for titles. */
	export let noun;
	export let onRename = (_id) => {};
	export let onDelete = (_id) => {};

	const hasArtifacts = (doc) => Object.keys(doc.attached ?? {}).length > 0;
</script>

<div
	class="flex items-stretch gap-px border-b border-surface-500/20 bg-surface-100 dark:bg-surface-900 text-xs"
	data-testid="document-tabs"
>
	<div class="flex min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist">
		{#each $documents.items as doc (doc.id)}
			{@const open = doc.id === $documents.openId}
			<div
				class="group flex shrink-0 items-center gap-1 pl-3 pr-1 {open
					? 'bg-surface-50 dark:bg-surface-800 font-semibold'
					: 'opacity-70 hover:opacity-100'}"
				data-testid="document-tab"
			>
				<button
					type="button"
					role="tab"
					aria-selected={open}
					class="py-1.5 whitespace-nowrap"
					title="Double-click to rename"
					on:click={() => documents.open(doc.id)}
					on:dblclick={() => {
						documents.open(doc.id);
						onRename(doc.id);
					}}>{doc.name}</button
				>
				{#if hasArtifacts(doc)}
					<Paperclip size="11" class="opacity-60" aria-label="Has Artifacts" />
				{/if}
				<button
					type="button"
					class="btn-icon btn-icon-sm h-5 w-5 opacity-50"
					title="Delete {noun}"
					aria-label="Delete {doc.name}"
					on:click={() => onDelete(doc.id)}><X size="12" /></button
				>
			</div>
		{/each}
		<button
			type="button"
			class="btn-icon btn-icon-sm self-center opacity-70"
			title="New {noun}"
			aria-label="New {noun}"
			data-testid="document-new"
			on:click={() => documents.create()}><Plus size="14" /></button
		>
	</div>
	<div class="flex shrink-0 items-center gap-1 px-2">
		<slot />
	</div>
</div>
