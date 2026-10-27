<script>
	// A record's artifacts as rows to pick from, with an icon by how each
	// previews and its size.
	import { FileIcon, FileText, ImageIcon, Video } from "lucide-svelte";
	import { formatSize, previewOf } from "./artifacts.js";

	/** ArtifactMetadata: { ID, Filename, MimeType, Size }. */
	export let artifacts = [];
	/** The picked artifact's ID. */
	export let selected = null;

	const ICONS = { image: ImageIcon, video: Video, pdf: FileText, text: FileText, file: FileIcon };
</script>

<div class="logbook-artifacts min-h-0 overflow-auto">
	{#each artifacts as artifact (artifact.ID)}
		{@const on = String(selected) === String(artifact.ID)}
		<button
			type="button"
			class="relative flex h-7 w-full items-center gap-2 pl-2 pr-1 text-left text-[11px] {on
				? 'bg-primary-500/20'
				: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
			aria-current={on ? "true" : undefined}
			on:click={() => (selected = artifact.ID)}
		>
			{#if on}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
			<svelte:component this={ICONS[previewOf(artifact)]} size={13} class="flex-none text-primary-500" />
			<span class="min-w-0 flex-1 truncate" title={artifact.Filename}>{artifact.Filename}</span>
			<span class="flex-none text-[10px] opacity-50">{formatSize(artifact.Size)}</span>
		</button>
	{:else}
		<p class="px-2 py-3 text-center text-[11px] opacity-60">No artifacts</p>
	{/each}
</div>
