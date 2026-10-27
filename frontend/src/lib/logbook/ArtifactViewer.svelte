<script>
	// Previews an artifact by its content type: images fit or at full size,
	// video in a player, PDF in a frame, text-like types as text (JSON
	// pretty-printed), and anything else as a card with Download.
	import { onDestroy } from "svelte";
	import { getToastStore } from "@skeletonlabs/skeleton";
	import { Download, FileIcon, Maximize2, Minimize2, WrapText } from "lucide-svelte";
	import DrawerEditor from "../ledger/DrawerEditor.svelte";
	import { toastError } from "../toasts.js";
	import { artifactBlob, downloadArtifact, prettyText, previewKind, sizeText } from "./artifacts.js";

	/** The artifact (ArtifactMetadata, or a staged one carrying File), or null. */
	export let artifact = null;
	const toastStore = getToastStore();

	let actual = false;
	let wrap = true;
	let url = null;
	let text = "";
	let state = "idle"; // "loading", "ready" or "failed"

	$: kind = previewKind(artifact);
	$: load(artifact);

	async function load(target) {
		if (url) URL.revokeObjectURL(url);
		url = null;
		text = "";
		if (!target) return;
		state = "loading";
		try {
			const blob = await artifactBlob(target);
			if (target !== artifact) return;
			if (previewKind(target) === "text") text = prettyText(target, await blob.text());
			else if (previewKind(target) !== "other") url = URL.createObjectURL(blob);
			state = "ready";
		} catch (error) {
			if (target !== artifact) return;
			console.error("Reading the artifact failed:", error);
			state = "failed";
		}
	}
	onDestroy(() => url && URL.revokeObjectURL(url));

	async function download() {
		try {
			if (await downloadArtifact(artifact)) toastStore.trigger({ message: "File saved" });
		} catch (error) {
			toastError(toastStore, "Not saved", error);
		}
	}

	const quiet = "flex-none p-0.5 opacity-60 hover:opacity-100";
</script>

{#if artifact}
	<div class="flex h-full min-h-0 flex-col" data-artifact-viewer>
		<div class="flex h-7 flex-none items-center gap-2 border-b border-surface-500/30 px-2 text-[11px]">
			<span class="min-w-0 flex-1 truncate font-semibold" title={artifact.Filename}>{artifact.Filename}</span>
			<span class="flex-none font-mono text-[10px] opacity-60">{artifact.MimeType} · {sizeText(artifact.Size)}</span>
			{#if kind === "image"}
				<button type="button" class={quiet} title={actual ? "Fit" : "Actual size"} on:click={() => (actual = !actual)}>
					{#if actual}<Minimize2 size={12} />{:else}<Maximize2 size={12} />{/if}
				</button>
			{:else if kind === "text"}
				<button type="button" class="{quiet} {wrap ? '!opacity-100' : ''}" title="Wrap lines" on:click={() => (wrap = !wrap)}><WrapText size={12} /></button>
			{/if}
			{#if !artifact.File}
				<button type="button" class={quiet} title="Download" aria-label="Download" on:click={download}><Download size={12} /></button>
			{/if}
		</div>
		<div class="min-h-0 flex-1 {kind === 'text' ? '' : 'overflow-auto'} bg-surface-100/60 dark:bg-surface-900/60">
			{#if state === "loading"}
				<p class="p-8 text-center text-[11px] opacity-60">Loading…</p>
			{:else if state === "failed"}
				<p class="p-8 text-center text-[11px] opacity-60">Couldn't read this artifact.</p>
			{:else if kind === "image" && url}
				<div class="flex min-h-full items-center justify-center p-2">
					<img src={url} alt={artifact.Filename} class={actual ? "max-w-none" : "max-h-full max-w-full object-contain"} />
				</div>
			{:else if kind === "video" && url}
				<div class="flex h-full items-center justify-center p-4">
					<!-- svelte-ignore a11y-media-has-caption -->
					<video src={url} controls class="max-h-full max-w-full"></video>
				</div>
			{:else if kind === "pdf" && url}
				<iframe title={artifact.Filename} src={url} class="h-full w-full border-0 bg-white"></iframe>
			{:else if kind === "text"}
				{#key artifact.ID}<DrawerEditor value={text} {wrap} />{/key}
			{:else}
				<div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[11px]">
					<FileIcon size={28} class="opacity-50" />
					<span class="font-semibold">{artifact.Filename}</span>
					<span class="opacity-60">No preview for {artifact.MimeType}</span>
					{#if !artifact.File}
						<button type="button" class="mt-1 flex items-center gap-1 underline" on:click={download}><Download size={12} />Download</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{:else}
	<p class="p-8 text-center text-[11px] opacity-60">No artifact selected</p>
{/if}
