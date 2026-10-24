<script>
	// The facts at the top of a drawer's details column: method, status and
	// timing; host and path on one line; content type and size. The Ledger's
	// DrawerRail and the Armory's ArmoryDrawerRail both show it; `prefix`
	// names its classes (`<prefix>-drawer-facts`, `<prefix>-drawer-url`).
	import { statusClass } from "../launchpad/format.js";
	import { formatSize, statusText } from "./table.js";

	/** The pair's table row. */
	export let pair;
	export let timing = "";
	/** "ledger" or "armory". */
	export let prefix = "ledger";

	$: hasResponse = Number(pair.StatusCode) > 0;
</script>

<div class="{prefix}-drawer-facts flex-none space-y-0.5 px-3 py-2 font-mono text-[11px] leading-4">
	<div class="flex flex-wrap gap-x-2">
		<b>{pair.Method ?? ""}</b>
		<span class={statusClass(pair.StatusCode)}>{hasResponse ? statusText(pair.StatusCode) : "pending"}</span>
		{#if timing}<span class="opacity-60">{timing}</span>{/if}
	</div>
	<!-- One line; the whole URL is in the tooltip. -->
	<div class="{prefix}-drawer-url truncate" title="{pair.Host ?? ''}{pair.Path ?? ''}">
		<span class="opacity-70">{pair.Host ?? ""}</span>{pair.Path ?? ""}
	</div>
	<div class="opacity-60">
		{pair.ContentType || (hasResponse ? "no content type" : "no response yet")}{formatSize(pair.Length)
			? ` · ${formatSize(pair.Length)}`
			: ""}
	</div>
</div>
