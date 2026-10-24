<script>
	// The CA for an upstream proxy being added: pasted, or read from a file.
	// Nothing is saved here; Done hands the PEM back through the modal's
	// response, and Marasi checks it when the entry is added.
	// meta: { ca }, the PEM chosen so far.
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { X } from "lucide-svelte";
	import { readUpstreamProxyCAFile } from "../../stores/upstreamProxyStore.js";
	import { primaryVariant } from "../launchpad/format.js";

	export let parent;
	const modalStore = getModalStore();
	let ca = $modalStore[0]?.meta?.ca ?? "";
	let error = "";

	$: primary = primaryVariant($modeCurrent);

	function readFile() {
		error = "";
		readUpstreamProxyCAFile()
			.then((contents) => {
				if (contents) ca = contents;
			})
			.catch((readError) => (error = String(readError)));
	}

	function done() {
		$modalStore[0]?.response?.(ca.trim());
		modalStore.close();
	}
</script>

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card w-modal space-y-3 rounded-0 bg-surface-50-800-token p-4 text-sm shadow-xl text-surface-900-50-token"
		on:keydown={(event) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				modalStore.close();
			}
		}}
	>
		<header class="flex items-center justify-between">
			<h2 class="text-base font-bold">CA Certificate</h2>
			<button aria-label="Close" on:click={modalStore.close}><X size={16} /></button>
		</header>
		<form class="space-y-3" on:submit|preventDefault={done}>
			<textarea
				class="textarea h-40 bg-white py-1 font-mono text-[11px] ring-0 dark:bg-surface-700 border-0 focus:border-0 focus:ring-0"
				placeholder="Paste a PEM, or read one from a file"
				aria-label="CA certificate"
				bind:value={ca}
			></textarea>
			{#if error}
				<p class="text-xs text-error-500" role="alert">{error}</p>
			{/if}
			<footer class="modal-footer {parent.regionFooter}">
				<button type="button" class="btn btn-sm {parent.buttonNeutral} mr-auto" on:click={readFile}
					>Read from File</button
				>
				<button type="button" class="btn btn-sm {parent.buttonNeutral}" on:click={modalStore.close}>Cancel</button>
				<button type="submit" class="btn btn-sm {primary}">Done</button>
			</footer>
		</form>
	</div>
{/if}
