<script>
	// Delete for a tool document that has Artifacts: "Delete drawing?
	// Attached to <records>." with an unchecked "Also remove from them".
	// Unticked, the Artifacts stay on their records. Opened by
	// documentPrompts.deleteDocument.
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts.js";
	import { attachedTo } from "./attachments.js";
	import { attachments, recordTitle } from "./toolItems.js";

	/** A toolDocuments collection. */
	export let documents;
	export let docId;
	export let noun = "drawing";
	/** Skeleton passes its modal's parent props; unused. */
	export const parent = undefined;

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	let alsoRemove = false;
	let busy = false;

	$: doc = $documents.items.find((d) => d.id === docId);
	$: records = doc ? attachedTo(doc, recordTitle) : [];

	async function confirm() {
		if (!doc || busy) return;
		busy = true;
		try {
			if (alsoRemove) await attachments.detachAll(doc);
			documents.remove(doc.id);
			modalStore.close();
		} catch (err) {
			toastError(toastStore, "Couldn't remove the Artifacts", err);
		} finally {
			busy = false;
		}
	}
</script>

{#if $modalStore[0] && doc}
	<div class="card w-modal-slim space-y-3 bg-surface-50 p-4 shadow-xl dark:bg-surface-800" data-testid="delete-document">
		<header class="text-base font-bold">Delete {noun}?</header>
		<p class="text-sm">Attached to {records.join(", ")}.</p>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" class="checkbox" data-testid="delete-also-remove" bind:checked={alsoRemove} />
			Also remove from {records.length === 1 ? "it" : "them"}
		</label>
		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={() => modalStore.close()}>Cancel</button>
			<button type="button" class="btn btn-sm {primaryVariant($modeCurrent)}" data-testid="delete-confirm" disabled={busy} on:click={confirm}
				>Delete</button
			>
		</div>
	</div>
{/if}
