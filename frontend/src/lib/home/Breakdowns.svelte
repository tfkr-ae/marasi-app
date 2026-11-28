<script>
	// Home's breakdowns, under the figures: one card with Responses by status
	// beside Findings by severity (stacked below md). Each bar, and the
	// Findings heading, opens the list it counts.
	import { createEventDispatcher } from "svelte";
	import { ArrowUpRight } from "lucide-svelte";
	import { count as n } from "./overview.js";
	/** overviewOf's statusClasses: { "2xx": { count, colour, destination }, … } */
	export let statusClasses = {};
	/** overviewOf's findings: { total, unfinished, summary, bySeverity, destination } */
	export let findings = { total: 0, unfinished: 0, summary: "", bySeverity: [], destination: null };
	const dispatch = createEventDispatcher();

	const severityBar = {
		Critical: "bg-error-700",
		High: "bg-error-500",
		Medium: "bg-warning-500",
		Low: "bg-tertiary-500",
		Informational: "bg-surface-400",
	};
	// One row template for both columns, so every bar starts and ends at
	// the same place: a label wide enough for "Informational", the bar, the count.
	const row = "action-card w-full grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2 py-1";
	const share = (count, total) => (total ? (count / total) * 100 : 0);
	$: classTotal = Object.values(statusClasses).reduce((sum, c) => sum + (c.count ?? 0), 0);
</script>

<div
	class="card bg-surface-100-500-token text-surface-900-50-token grid grid-cols-1 md:grid-cols-2 md:divide-x divide-surface-300-600-token"
	data-testid="home-breakdowns"
>
	<div class="p-3" data-testid="home-status-classes">
		<h3 class="h-6 mb-2 flex items-center text-sm font-bold">Responses by status</h3>
		{#each Object.entries(statusClasses) as [key, statusClass] (key)}
			<button
				type="button"
				class={row}
				data-testid="home-status-class"
				data-class={key}
				on:click={() => dispatch("open", statusClass.destination)}
			>
				<span class="text-left">{key}</span>
				<span class="h-2 bg-surface-300-600-token">
					<span
						class="block h-2"
						style="width:{share(statusClass.count ?? 0, classTotal)}%; background-color: rgb(var(--color-{statusClass.colour}-500))"
					></span>
				</span>
				<span class="text-right font-bold" data-testid="home-status-class-count">
					{#if statusClass.count === null}<span class="inline-block h-3 w-6 animate-pulse bg-surface-300 align-middle dark:bg-surface-600"></span>{:else}{n(statusClass.count)}{/if}
				</span>
			</button>
		{/each}
	</div>
	<div class="p-3 border-t md:border-t-0 border-surface-300-600-token" data-testid="home-findings">
		<button
			type="button"
			class="action-card w-full h-6 mb-2 flex items-center justify-between"
			data-testid="home-findings-heading"
			on:click={() => dispatch("open", findings.destination)}
		>
			<span class="flex items-baseline gap-1.5">
				<span class="text-sm font-bold">Findings</span>
				<span class="text-2xs opacity-70">{findings.summary}</span>
			</span>
			<ArrowUpRight size={12} />
		</button>
		{#each findings.bySeverity as { severity, count, destination } (severity)}
			<button
				type="button"
				class={row}
				data-testid="home-severity"
				data-severity={severity}
				on:click={() => dispatch("open", destination)}
			>
				<span class="text-left">{severity}</span>
				<span class="h-2 bg-surface-300-600-token">
					<span class="block h-2 {severityBar[severity]}" style="width:{share(count, findings.total)}%"></span>
				</span>
				<span class="text-right font-bold">{n(count)}</span>
			</button>
		{/each}
	</div>
</div>

