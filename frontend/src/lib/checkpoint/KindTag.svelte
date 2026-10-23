<script>
	// REQ / RES / WS tag for an intercepted item.
	import { KIND_LABELS } from "./items.js";

	export let type;
	const TONE = {
		request: "bg-primary-500/20 text-primary-700 dark:text-primary-300",
		response: "bg-tertiary-500/20 text-tertiary-700 dark:text-tertiary-300",
		websocket: "bg-success-500/25 text-success-800 dark:text-success-400",
	};
</script>

<span class="inline-block w-8 flex-none rounded px-1 text-center font-mono text-[10px] font-bold {TONE[type] ?? ''}">{KIND_LABELS[type] ?? ""}</span>
