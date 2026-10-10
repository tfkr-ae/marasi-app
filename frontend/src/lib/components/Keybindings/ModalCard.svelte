<script>
	// A card shown on top of the keybindings modal's content (shortcut capture
	// and confirmations). Skeleton queues modals, so a confirm modal triggered
	// from inside this one would only appear after it closed.
	export let title;
</script>

<div class="absolute inset-0 z-30 grid place-items-center bg-surface-900/40" {...$$restProps}>
	<div
		class="card w-modal-slim space-y-4 rounded-none border-t-4 border-primary-500 p-4 shadow-xl bg-surface-50-800-token text-surface-900-50-token"
		role="alertdialog"
		aria-label={title}
	>
		<h3 class="text-xl font-bold">{title}</h3>
		<slot />
		<footer class="flex justify-end gap-2">
			<slot name="footer" />
		</footer>
	</div>
</div>
