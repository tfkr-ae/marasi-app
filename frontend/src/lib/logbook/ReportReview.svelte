<script>
	// The export modal's right column: what the report holds (findings per
	// severity; findings, test cases and evidence), Needs work folded to one
	// line that opens to the gaps, and the contents in report order. It
	// follows Include test cases and filters nothing else: ExportReport
	// exports the whole Logbook.
	import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-svelte";
	import { SEVERITY_MARK } from "./severity.js";
	import { SEVERITIES, reportOf } from "../../stores/logbookStore";

	export let store;
	export let includeTestCases = true;
	/** Called with a gap, { kind, record, key, label }, when clicked. */
	export let onGap = (gap) => {};

	let gapsOpen = false;

	$: review = reportOf($store, { includeTestCases });
	$: missing = new Set(review.gaps.map((g) => `${g.kind}:${g.record.ID}`));
	$: summary = review.gapGroups.map((g) => `${g.items.length} ${g.label.toLowerCase()}`).join(", ");
	const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
	const number = (prefix, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`;
	const heading = "mb-2 text-sm font-bold";
</script>

<div class="logbook-report-review space-y-5 text-xs">
	<section>
		<h3 class={heading}>In the report</h3>
		<div class="flex gap-1">
			{#each SEVERITIES as severity}
				<div class="flex-1 py-1.5 text-center ring-1 ring-surface-500/20">
					<div class="text-sm font-bold tabular-nums">{review.severityCounts[severity]}</div>
					<div class="flex items-center justify-center gap-1 text-[10px] opacity-70">
						<span class="h-2 w-2 rounded-sm {SEVERITY_MARK[severity]}"></span>{severity === "Informational" ? "Info" : severity}
					</div>
				</div>
			{/each}
		</div>
		<p id="exportTotals" class="mt-2 text-[11px] opacity-70">
			{plural(review.findings.length, "finding", "findings")} ·
			{includeTestCases ? plural(review.testCases.length, "test case", "test cases") : "no test cases"} ·
			{plural(review.evidence, "piece", "pieces")} of evidence
		</p>
	</section>
	<section>
		<button
			id="exportNeedsWork"
			type="button"
			class="flex w-full items-center gap-2 px-2.5 py-2 text-left {review.gaps.length
				? 'bg-warning-500/15 hover:bg-warning-500/25'
				: 'bg-success-500/15'}"
			disabled={!review.gaps.length}
			aria-expanded={gapsOpen}
			on:click={() => (gapsOpen = !gapsOpen)}
		>
			{#if review.gaps.length}
				<AlertTriangle size={13} class="flex-none text-warning-800 dark:text-warning-500" />
			{:else}
				<CheckCircle2 size={13} class="flex-none text-success-600 dark:text-success-500" />
			{/if}
			<span class="min-w-0 flex-1 truncate text-[11px]" title={summary}>
				{#if review.gaps.length}<b>Needs work {review.gaps.length}</b> · {summary}{:else}<b>Nothing missing</b>{/if}
			</span>
			{#if review.gaps.length}
				{#if gapsOpen}<ChevronDown size={12} class="flex-none" />{:else}<ChevronRight size={12} class="flex-none" />{/if}
			{/if}
		</button>
		{#if gapsOpen && review.gaps.length}
			<div class="mt-2 space-y-2 pl-2">
				{#each review.gapGroups as group (group.label)}
					<div>
						<div class="text-[11px] font-semibold opacity-80">
							{group.label} <span class="font-normal opacity-60">{group.items.length}</span>
						</div>
						{#each group.items as gap (`${gap.kind}:${gap.record.ID}:${gap.key}`)}
							<button
								type="button"
								class="logbook-gap block w-full truncate py-0.5 pl-3 text-left text-[11px] hover:underline"
								data-kind={gap.kind}
								data-id={gap.record.ID}
								data-item={gap.key}
								title="Open {gap.record.Title || 'Untitled'}"
								on:click={() => onGap(gap)}>{gap.record.Title || "Untitled"}</button
							>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</section>
	<section>
		<h3 class={heading}>Contents</h3>
		{#each review.findings as finding, i (finding.ID)}
			<div class="flex items-center gap-2 py-0.5 text-[11px]">
				<span class="w-9 flex-none font-mono text-[10px] opacity-60">{number("F", i)}</span>
				<span class="h-2 w-2 flex-none rounded-sm {SEVERITY_MARK[finding.Severity] ?? 'bg-surface-400'}"></span>
				<span class="min-w-0 flex-1 truncate">{finding.Title || "Untitled"}</span>
				{#if missing.has(`finding:${finding.ID}`)}
					<AlertTriangle size={10} class="flex-none text-warning-800 dark:text-warning-500" />
				{/if}
			</div>
		{/each}
		{#if review.testCases.length}
			<div class="mt-2"></div>
			{#each review.testCases as testCase, i (testCase.ID)}
				<div class="flex items-center gap-2 py-0.5 text-[11px]">
					<span class="w-9 flex-none font-mono text-[10px] opacity-60">{number("TC", i)}</span>
					<span class="min-w-0 flex-1 truncate">{testCase.Title || "Untitled"}</span>
					{#if missing.has(`testCase:${testCase.ID}`)}
						<AlertTriangle size={10} class="flex-none text-warning-800 dark:text-warning-500" />
					{/if}
				</div>
			{/each}
		{/if}
	</section>
</div>
