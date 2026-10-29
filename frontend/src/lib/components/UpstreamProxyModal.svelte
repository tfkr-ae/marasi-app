<script>
	// Edits one upstream proxy: its URL and its CA. Marasi never returns the
	// URL's credentials, so the URL field starts empty and empty keeps it.
	// meta: { name, address, hasCA }.
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { X } from "lucide-svelte";
	import { readUpstreamProxyCAFile, upstreamProxyStore } from "../../stores/upstreamProxyStore.js";
	import { primaryVariant } from "../launchpad/format.js";

	export let parent;
	const modalStore = getModalStore();
	const meta = $modalStore[0]?.meta ?? {};
	let url = "";
	let ca = "";
	let removeCA = false;
	let saving = false;
	let error = "";
	const field =
		"input h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0";

	$: primary = primaryVariant($modeCurrent);
	$: changed = url.trim() !== "" || ca.trim() !== "" || removeCA;

	function readFile() {
		error = "";
		readUpstreamProxyCAFile()
			.then((contents) => {
				if (contents) ca = contents;
			})
			.catch((readError) => (error = String(readError)));
	}

	function save() {
		if (!changed || saving) return;
		saving = true;
		error = "";
		upstreamProxyStore
			.update(meta.name, url.trim(), removeCA ? "" : ca.trim(), removeCA)
			.then(() => modalStore.close())
			.catch((saveError) => (error = String(saveError)))
			.finally(() => (saving = false));
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
			<h2 class="text-base font-bold">Edit {meta.name}</h2>
			<button aria-label="Close" on:click={modalStore.close}><X size={16} /></button>
		</header>
		<form class="space-y-3" on:submit|preventDefault={save}>
			<label class="block space-y-1">
				<span class="text-xs">URL</span>
				<input
					class="{field} font-mono"
					type="text"
					placeholder={meta.address || "scheme://user:pass@host:port"}
					bind:value={url}
				/>
				<span class="block text-xs opacity-70">Leave empty to keep. Include user:pass@ if it needs them.</span>
			</label>
			<div class="space-y-1">
				<div class="flex items-center justify-between">
					<span class="text-xs">CA certificate</span>
					<button
						type="button"
						class="btn btn-sm {parent.buttonNeutral}"
						disabled={removeCA}
						on:click={readFile}>Read from File</button
					>
				</div>
				<textarea
					class="textarea h-28 bg-white py-1 font-mono text-2xs ring-0 dark:bg-surface-700 border-0 focus:border-0 focus:ring-0"
					placeholder={meta.hasCA ? "Paste a PEM to replace the CA" : "Paste a PEM to trust its CA"}
					aria-label="CA certificate"
					disabled={removeCA}
					bind:value={ca}
				></textarea>
			</div>
			{#if meta.hasCA}
				<label class="flex items-center gap-2 text-xs">
					<input type="checkbox" class="checkbox" bind:checked={removeCA} />
					Remove the CA
				</label>
			{/if}
			{#if error}
				<p class="text-xs text-error-500" role="alert">{error}</p>
			{/if}
			<footer class="modal-footer {parent.regionFooter}">
				<button type="button" class="btn btn-sm {parent.buttonNeutral}" on:click={modalStore.close}>Cancel</button>
				<button type="submit" class="btn btn-sm {primary}" disabled={!changed || saving}>Save</button>
			</footer>
		</form>
	</div>
{/if}
