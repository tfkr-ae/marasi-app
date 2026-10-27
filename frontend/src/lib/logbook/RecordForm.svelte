<script>
	// The modal's form: the title, then a finding's severity, CVSS and test
	// case, or a test case's template, category, tags, description and
	// findings; then the long text (writeup and treatment plan, or note),
	// each with Expand. Every change goes to the edit session's draft.
	import { Maximize2 } from "lucide-svelte";
	import { SEVERITIES, categoryOf, logbookStore } from "../../stores/logbookStore.js";
	import CVSSCalculator from "../components/CVSSCalculator.svelte";
	import TestCasePicker from "./TestCasePicker.svelte";
	import TemplatePicker from "./TemplatePicker.svelte";
	import TagInput from "./TagInput.svelte";
	import { SEVERITY_BADGE } from "./severityColors.js";

	export let session;
	/** The long-text field that has the whole modal, or null. */
	export let expanded = null;
	export let titleInput = null;

	$: finding = session.kind === "finding";
	$: draft = session.draft;
	$: texts = finding
		? [
				{ key: "WriteUp", label: "Writeup", placeholder: "What is wrong, where, and how to reproduce it", rows: 10 },
				{ key: "TreatmentPlan", label: "Treatment plan", placeholder: "How to fix it", rows: 6 },
			]
		: [{ key: "Note", label: "Note", placeholder: "What you tried and what happened", rows: 12 }];

	// An unscored finding opens on the metrics; a scored one folds them.
	let cvssOpen = !session.draft.CVSSVector;

	$: categories = [...new Set($logbookStore.testCases.map((t) => t.Category?.trim()).filter(Boolean))].sort();
	$: findings = finding
		? []
		: $logbookStore.findings
				.filter((f) => String(f.TestCaseID ?? "") === String(draft.ID ?? "-"))
				.sort((a, b) => SEVERITIES.indexOf(a.Severity) - SEVERITIES.indexOf(b.Severity));

	const update = (patch) => logbookStore.updateDraft(patch);
	const label = "mb-1 block text-[11px] font-semibold opacity-70";
	const field = "input h-8 rounded-token border-0 py-1 text-xs";
	const SHORT = { Informational: "Info" };
</script>

<input
	bind:this={titleInput}
	data-field="Title"
	class="input h-9 flex-none rounded-token border-0 py-1 text-sm font-bold"
	placeholder={finding ? "Finding title" : "Test case title"}
	value={draft.Title}
	on:input={(e) => update({ Title: e.currentTarget.value })}
/>

{#if finding}
	<section>
		<span class={label}>Severity</span>
		<div class="grid grid-cols-5 gap-1" data-field="Severity">
			{#each SEVERITIES as severity}
				<button
					type="button"
					class="rounded-sm px-1 py-1 text-[11px] font-semibold {draft.Severity === severity ? SEVERITY_BADGE[severity] : 'bg-surface-200-700-token opacity-70 hover:opacity-100'}"
					aria-pressed={draft.Severity === severity}
					on:click={() => update({ Severity: severity })}>{SHORT[severity] ?? severity}</button
				>
			{/each}
		</div>
	</section>
	<section data-field="CVSSVector">
		<span class={label}>CVSS 3.1</span>
		<CVSSCalculator
			vector={draft.CVSSVector ?? ""}
			bind:open={cvssOpen}
			stacked
			on:change={(e) => update({ CVSSVector: e.detail.vector, CVSSScore: e.detail.score ?? 0 })}
		/>
	</section>
	<section>
		<span class={label}>Test case</span>
		<TestCasePicker value={draft.TestCaseID} testCases={$logbookStore.testCases} on:change={(e) => update({ TestCaseID: e.detail })} />
	</section>
{:else}
	<TemplatePicker isNew={session.isNew} on:pick={(e) => update(e.detail)} />
	<label class="block">
		<span class={label}>Category</span>
		<input data-field="Category" class={field} list="logbook-categories" placeholder="e.g. Access Control" value={draft.Category} on:input={(e) => update({ Category: e.currentTarget.value })} />
		<datalist id="logbook-categories">{#each categories as category}<option value={category} />{/each}</datalist>
	</label>
	<section>
		<span class={label}>Tags</span>
		<TagInput tags={draft.Tags ?? []} on:change={(e) => update({ Tags: e.detail })} />
	</section>
	<label class="block">
		<span class={label}>Description</span>
		<input data-field="Description" class={field} placeholder="What this test covers" value={draft.Description} on:input={(e) => update({ Description: e.currentTarget.value })} />
	</label>
	{#if !session.isNew}
		<section>
			<span class={label}>Findings <span class="font-normal opacity-70">{findings.length}</span></span>
			{#each findings as f (f.ID)}
				<div class="flex items-center gap-2 py-0.5 text-[11px]">
					<span class="badge flex-none rounded-sm px-1.5 py-0 text-[10px] {SEVERITY_BADGE[f.Severity] ?? 'variant-soft'}">{f.Severity}</span>
					<span class="min-w-0 flex-1 truncate">{f.Title}</span>
				</div>
			{:else}
				<p class="text-[11px] opacity-60">None yet</p>
			{/each}
		</section>
	{/if}
{/if}

{#each texts as t (t.key)}
	<div class="flex flex-col">
		<span class="mb-1 flex items-center">
			<label for="logbook-{t.key}" class="flex-1 text-[11px] font-semibold opacity-70">{t.label}</label>
			<button type="button" class="flex items-center gap-1 text-[11px] opacity-60 hover:opacity-100" data-expand={t.key} on:click={() => (expanded = t.key)}>
				<Maximize2 size={11} />Expand
			</button>
		</span>
		<textarea
			id="logbook-{t.key}"
			data-field={t.key}
			class="textarea w-full rounded-token border-0 text-xs leading-relaxed"
			rows={t.rows}
			placeholder={t.placeholder}
			value={draft[t.key] ?? ""}
			on:input={(e) => update({ [t.key]: e.currentTarget.value })}
		></textarea>
	</div>
{/each}
