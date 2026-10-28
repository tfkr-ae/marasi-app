<script>
	// One artifact, previewed by its content type: an image to fit or at
	// actual size, video in a player, a PDF in a frame, text-like files as
	// text (JSON pretty-printed), and anything else as a Download card.
	// Bytes come from GetArtifact, saving from DownloadArtifact.
	import { onDestroy } from "svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Download, FileIcon, Maximize2, Minimize2 } from "lucide-svelte";
	import DrawerEditor from "../ledger/DrawerEditor.svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts.js";
	import { lineWrap } from "../../stores";
	import { WRAP_SUSPENDED } from "../lineWrap.js";
	import { artifactBytes, artifactText, formatSize, previewOf } from "./artifacts.js";

	/** ArtifactMetadata: { ID, Filename, MimeType, Size }, or null. */
	export let artifact = null;
	/** readArtifact(id) and downloadArtifact(id), as the Logbook store has them. */
	export let store;

	const toastStore = getToastStore();

	let actual = false;
	// Whether a shown long string stopped the lines wrapping.
	let paused = false;
	let url = null;
	let text = "";
	// undefined while the bytes load, null when they could not be read.
	let loaded;
	let loadingID = null;

	$: primary = primaryVariant($modeCurrent);
	$: kind = artifact ? previewOf(artifact) : null;
	// A new artifact starts wrapped until its editor says otherwise.
	$: artifact, (paused = false);
	$: load(artifact, kind);

	async function load(target, how) {
		release();
		text = "";
		loaded = undefined;
		loadingID = target?.ID ?? null;
		if (!target || how === "file") return (loaded = true);
		const full = await store.readArtifact(target.ID).catch(() => null);
		if (loadingID !== target.ID) return;
		if (!full) return (loaded = null);
		const bytes = artifactBytes(full.Data);
		if (how === "text") text = artifactText(bytes, target);
		// A PDF frames from a blob URL, which WebKit and Chrome both allow.
		else url = URL.createObjectURL(new Blob([bytes], { type: how === "pdf" ? "application/pdf" : target.MimeType }));
		loaded = true;
	}

	function release() {
		if (url) URL.revokeObjectURL(url);
		url = null;
	}
	onDestroy(release);

	async function download() {
		try {
			if (await store.downloadArtifact(artifact.ID))
				toastStore.trigger({ message: "Saved", background: "variant-filled-success" });
		} catch (error) {
			toastError(toastStore, "Failed to save the artifact", error);
		}
	}

	const quiet = "flex-none p-0.5 opacity-60 hover:opacity-100";
</script>

{#if artifact}
	<div class="logbook-artifact flex h-full min-h-0 flex-col" data-preview={kind}>
		<div class="flex h-7 flex-none items-center gap-2 border-b border-surface-500/30 px-2 text-[11px]">
			<span class="min-w-0 flex-1 truncate font-semibold" title={artifact.Filename}>{artifact.Filename}</span>
			<span class="flex-none font-mono text-[10px] opacity-60"
				>{artifact.MimeType || "unknown"} · {formatSize(artifact.Size)}</span
			>
			{#if kind === "image"}
				<button type="button" class={quiet} title={actual ? "Fit" : "Actual size"} on:click={() => (actual = !actual)}>
					{#if actual}<Minimize2 size={12} />{:else}<Maximize2 size={12} />{/if}
				</button>
			{:else if kind === "text" && paused}
				<span class="logbook-wrap-suspended flex-none text-[10px] opacity-60" title={WRAP_SUSPENDED}>Not wrapped</span>
			{/if}
			<button type="button" class={quiet} title="Download" aria-label="Download" on:click={download}
				><Download size={12} /></button
			>
		</div>
		<div class="min-h-0 flex-1 {kind === 'text' ? '' : 'overflow-auto'} bg-surface-100/60 dark:bg-surface-900/60">
			{#if loaded === undefined}
				<p class="p-8 text-center text-[11px] opacity-50">Loading…</p>
			{:else if loaded === null}
				<p class="p-8 text-center text-[11px] opacity-60">Could not read the artifact</p>
			{:else if kind === "image"}
				<div class="flex min-h-full items-center justify-center p-2">
					<img
						src={url}
						alt={artifact.Filename}
						class={actual ? "max-w-none" : "max-h-full max-w-full object-contain"}
					/>
				</div>
			{:else if kind === "video"}
				<div class="flex h-full items-center justify-center bg-black p-2">
					<!-- svelte-ignore a11y-media-has-caption -->
					<video src={url} controls class="max-h-full max-w-full"></video>
				</div>
			{:else if kind === "pdf"}
				<iframe title={artifact.Filename} src={url} class="h-full w-full border-0 bg-white"></iframe>
			{:else if kind === "text"}
				<div class="h-full bg-white pt-[3px] dark:bg-[#282c34]">
					{#key artifact.ID}<DrawerEditor value={text} wrap={$lineWrap} on:suspend={(e) => (paused = e.detail)} />{/key}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[11px]">
					<FileIcon size={28} class="opacity-50" />
					<span class="font-semibold">{artifact.Filename}</span>
					<span class="opacity-60">{artifact.MimeType || "Unknown type"} · {formatSize(artifact.Size)}</span>
					<button type="button" class="btn btn-sm mt-1 {primary}" on:click={download}
						><Download size={12} class="mr-1" />Download</button
					>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<p class="p-8 text-center text-[11px] opacity-60">No artifacts</p>
{/if}
