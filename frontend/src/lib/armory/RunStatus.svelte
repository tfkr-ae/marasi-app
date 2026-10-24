<script>
	// A run's status as a badge: draft, in progress, complete, failed or
	// cancelled.
	export let status = "draft";
	const CLASS = {
		complete: "variant-filled-success",
		in_progress: "variant-filled-primary",
		failed: "variant-filled-error",
		cancelled: "variant-filled-warning",
	};
</script>

<span class="badge flex-none px-1.5 py-0 text-[10px] {CLASS[status] ?? 'variant-soft'}">
	{status.replace("_", " ")}
</span>
