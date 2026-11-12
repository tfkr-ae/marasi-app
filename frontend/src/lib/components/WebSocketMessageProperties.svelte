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

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* The WebSocket stream on a narrow mobile screen: Close Connection drops to
	   its icon beside the title, the four tabs share the width, the message
	   list and the chosen message are tabs (WebSocketMessagesTable.svelte),
	   the message's bar wraps, and its properties take two columns. */
	@media (max-width: 40rem) {
		:global(html.mobile .ws-properties) {
			grid-template-columns: max-content minmax(0, 1fr);
		}
		:global(html.mobile .ws-properties > .col-span-2:empty) {
			display: none;
		}
		:global(html.mobile .ws-properties > .col-span-3) {
			grid-column: span 1 / span 1;
		}
	}
</style>
