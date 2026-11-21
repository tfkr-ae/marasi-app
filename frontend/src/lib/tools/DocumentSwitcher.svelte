<script>
	// Switch Drawing (or Recipe): a filtered list of a collection's documents.
	// Opened through modalStore with `component: { ref: DocumentSwitcher,
	// props: { documents, noun } }`. Enter opens the first match.
	import { getModalStore } from "@skeletonlabs/skeleton";

	/** A toolDocuments collection (toolDocuments.js). */
	export let documents;
	export let noun = "drawing";
	/** Skeleton passes its modal's parent props; unused. */
	export const parent = undefined;

	const modalStore = getModalStore();
	let filter = "";
	$: matches = $documents.items.filter((doc) => doc.name.toLowerCase().includes(filter.trim().toLowerCase()));

	function pick(id) {
		documents.open(id);
		modalStore.close();
	}
</script>

{#if $modalStore[0]}
	<div class="card w-modal-slim space-y-3 p-4 shadow-xl bg-surface-50 dark:bg-surface-800" data-testid="document-switcher">
		<header class="text-base font-bold">Switch {noun}</header>
		<!-- svelte-ignore a11y-autofocus -->
		<input
			class="input text-xs"
			placeholder="Filter"
			autofocus
			bind:value={filter}
			on:keydown={(event) => {
				if (event.key === "Enter" && matches[0]) pick(matches[0].id);
			}}
		/>
		<ul class="max-h-72 overflow-auto text-xs">
			{#each matches as doc (doc.id)}
				<li>
					<button
						type="button"
						class="w-full px-2 py-1.5 text-left {doc.id === $documents.openId
							? 'bg-primary-500/20 font-semibold'
							: 'hover:bg-surface-500/15'}"
						on:click={() => pick(doc.id)}>{doc.name}</button
					>
				</li>
			{:else}
				<li class="px-2 py-1.5 opacity-60">No match</li>
			{/each}
		</ul>
	</div>
{/if}
