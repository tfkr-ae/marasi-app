<script>
	// REQ / RES / WS / STREAM / TRAILER tag for an intercepted item.
	import { KIND_LABELS } from "./items.js";

	export let type;
	const TONE = {
		request: "bg-primary-500/20 text-primary-700 dark:text-primary-300",
		response: "bg-tertiary-500/20 text-tertiary-700 dark:text-tertiary-300",
		websocket: "bg-success-500/25 text-success-800 dark:text-success-400",
		stream: "bg-secondary-500/25 text-secondary-800 dark:text-secondary-300",
		trailer: "bg-warning-500/25 text-warning-800 dark:text-warning-300",
	};
</script>

<span class="inline-block w-12 flex-none px-1 text-center font-mono text-3xs font-bold {TONE[type] ?? ''}">{KIND_LABELS[type] ?? ""}</span>
