<script>
	// The properties grid for one WebSocket message, shown above the payload
	// editor in Stream and Checkpoint.
	import {
		messageFlags,
		messageProperties,
		payloadNote,
	} from "../websocket/presentation.js";

	export let message;

	$: properties = messageProperties(message);
	$: flags = messageFlags(message);
	$: note = payloadNote(message);

	// Literal classes so Tailwind's content scan keeps them.
	const CHIP_CLASSES = {
		warning: "variant-soft-warning",
		error: "variant-soft-error",
		tertiary: "variant-soft-tertiary",
	};
</script>

<div
	class="ws-properties grid shrink-0 grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1 border-b border-surface-500/30 px-3 py-2 font-mono text-xs"
>
	<span class="opacity-60">Type</span><span>{properties.type}</span>
	<span class="opacity-60">Direction</span><span>{properties.direction}</span>
	<span class="opacity-60">Size</span><span>{properties.size}</span>
	<span class="opacity-60">Frames</span><span>{properties.frames}</span>
	<span class="opacity-60">Compressed</span><span>{properties.compressed}</span>
	<span class="col-span-2"></span>
	{#if flags.length}
		<span class="opacity-60">Flags</span>
		<span class="col-span-3 flex flex-wrap gap-1">
			{#each flags as flag (flag.key)}
				<span
					class="chip {CHIP_CLASSES[flag.tone]} text-xs"
					title={flag.title}>{flag.label}</span
				>
			{/each}
		</span>
	{/if}
	{#if note}
		<span class="opacity-60">Note</span>
		<span class="col-span-3 text-warning-600 dark:text-warning-400"
			>{note}</span
		>
	{/if}
</div>
