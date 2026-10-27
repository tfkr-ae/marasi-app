<script>
	// What a record needs before the report, read-only: the required items,
	// with "3/4" or "done" on their heading, then the optional ones, where an
	// unset item reads "Not set" without a warning. Every row is one height.
	import { AlertTriangle, Check, CircleDashed } from "lucide-svelte";
	import { severityFromScore } from "../cvss.js";
	import { SEVERITY_BADGE } from "./severity.js";
	import { completenessOf } from "../../stores/logbookStore";

	/** "finding" or "testCase". */
	export let kind;
	export let record;
	/** Every test case, to name a finding's. */
	export let testCases = [];

	$: completeness = completenessOf(kind, record);
	$: groups = [
		["Required", completeness.items.filter((item) => item.required)],
		["Optional", completeness.items.filter((item) => !item.required)],
	].filter(([, items]) => items.length);
	$: cvssSeverity = severityFromScore(record.CVSSScore);

	function valueOf(key) {
		if (key === "Requests") {
			const n = (record.Requests ?? []).length;
			return `${n} ${n === 1 ? "request" : "requests"}`;
		}
		if (key === "TestCaseID") return testCases.find((t) => String(t.ID) === String(record.TestCaseID))?.Title ?? "";
		return record[key] ?? "";
	}
</script>

<div class="logbook-checklist space-y-4">
	{#each groups as [group, items] (group)}
		<div>
			<div class="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
				<span class="opacity-50">{group}</span>
				{#if group === "Required"}
					{#if completeness.status === "done"}
						<span class="logbook-progress flex items-center gap-1 normal-case tracking-normal text-success-700 dark:text-success-400"
							><Check size={11} />done</span
						>
					{:else}
						<span class="logbook-progress normal-case tracking-normal text-warning-800 dark:text-warning-400"
							>{completeness.done}/{completeness.total}</span
						>
					{/if}
				{/if}
			</div>
			<div
				class="divide-y divide-surface-500/20 ring-1 {group === 'Optional' ? 'ring-surface-500/15' : 'ring-surface-500/25'}"
			>
				{#each items as item (item.key)}
					{@const value = valueOf(item.key)}
					<div
						data-item={item.key}
						class="grid h-12 grid-cols-[150px_minmax(0,1fr)] items-center gap-3 px-3"
					>
						<div class="flex items-center gap-2 text-[11px] font-semibold">
							{#if item.done}<Check size={13} class="flex-none text-success-600 dark:text-success-500" />
							{:else if item.required}<AlertTriangle size={13} class="flex-none text-warning-800 dark:text-warning-500" />
							{:else}<CircleDashed size={12} class="flex-none opacity-40" />{/if}
							<span class="whitespace-nowrap">{item.label}</span>
						</div>
						<div class="min-w-0">
							{#if !item.done}
								<p class="text-[11px] {item.required ? 'font-semibold text-warning-800 dark:text-warning-400' : 'opacity-50'}">
									{item.required ? "Missing" : "Not set"}
								</p>
							{:else if item.key === "CVSSVector"}
								<p class="flex items-center gap-2 text-xs">
									<b class="tabular-nums">{Number(record.CVSSScore).toFixed(1)}</b>
									{#if cvssSeverity}<span
											class="badge rounded-sm px-1.5 py-0.5 text-[10px] font-bold {SEVERITY_BADGE[cvssSeverity]}"
											>{cvssSeverity}</span
										>{/if}
									<code class="min-w-0 truncate bg-transparent p-0 font-mono text-[11px] opacity-70" title={record.CVSSVector}
										>{record.CVSSVector.replace("CVSS:3.1/", "")}</code
									>
								</p>
							{:else}
								<p class="line-clamp-2 whitespace-pre-line text-xs leading-snug" title={value}>{value}</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>
