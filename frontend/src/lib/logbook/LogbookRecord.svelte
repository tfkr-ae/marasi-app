<script>
	// A finding or test case in the workspace: Back, its severity (or the
	// test-case icon) and title, then Next, Edit and Delete; below, what it
	// needs, its linked records and its evidence.
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { tick } from "svelte";
	import { ArrowLeft, ArrowRight, BookCheck, Pencil, Trash2 } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import EvidenceViewer from "./EvidenceViewer.svelte";
	import LinkedRecords from "./LinkedRecords.svelte";
	import RecordChecklist from "./RecordChecklist.svelte";
	import { SEVERITY_BADGE } from "./severity.js";
	import { linkedOf } from "../../stores/logbookStore";

	export let store;
	/** "finding" or "testCase". */
	export let kind;
	export let record;
	/** The key of the item it opened at, such as a gap from the export, or null. */
	export let focus = null;
	/** Whether Next has a record to go to. */
	export let hasNext = false;
	export let nextTitle = "Next (N)";
	export let onBack = () => {};
	export let onNext = () => {};
	export let onEdit = () => {};
	export let onDelete = () => {};
	export let onOpen = (kind, id) => {};

	let width = 0;
	let body;

	$: primary = primaryVariant($modeCurrent);
	$: links = linkedOf($store, kind, record);
	// A new record starts at the top, or at the item it opened at.
	let shown = null;
	$: if (body && `${kind}:${record.ID}:${focus}` !== shown) {
		shown = `${kind}:${record.ID}:${focus}`;
		tick().then(() => {
			const item = focus && body?.querySelector(`[data-item="${focus}"]`);
			if (item) item.scrollIntoView?.({ block: "center" });
			else body?.scrollTo?.({ top: 0 });
		});
	}
	const heading = "mb-1.5 text-[10px] font-bold uppercase tracking-wider opacity-50";
</script>

<div class="logbook-record flex h-full min-h-0 flex-col" bind:clientWidth={width} data-kind={kind} data-id={record.ID}>
	<header class="flex h-12 flex-none items-center gap-2 border-b border-surface-500/30 px-4">
		<button id="logbookBack" class="btn btn-sm flex-none {primary}" title="Back to the list (Esc)" on:click={onBack}
			><ArrowLeft size={12} class="mr-1" />Back</button
		>
		{#if kind === "finding"}
			<span class="badge flex-none rounded-sm px-1.5 py-0.5 text-[10px] font-bold {SEVERITY_BADGE[record.Severity] ?? 'variant-soft'}"
				>{record.Severity || "None"}</span
			>
		{:else}
			<BookCheck size={15} class="flex-none text-tertiary-500" />
		{/if}
		<h1 class="min-w-0 flex-1 truncate text-sm font-bold" title={record.Title}>{record.Title}</h1>
		<button id="logbookNext" class="btn btn-sm flex-none {primary}" disabled={!hasNext} title={nextTitle} on:click={onNext}
			>Next<ArrowRight size={12} class="ml-1" /></button
		>
		<button id="logbookEdit" class="btn btn-sm flex-none {primary}" title="Edit" on:click={onEdit}
			><Pencil size={12} class="mr-1" />Edit</button
		>
		<button id="logbookDelete" class="btn btn-sm flex-none px-2.5 {primary}" title="Delete" aria-label="Delete" on:click={onDelete}
			><span class="flex h-5 items-center"><Trash2 size={14} /></span></button
		>
	</header>
	<div bind:this={body} class="min-h-0 flex-1 overflow-auto px-4 py-3 pb-24">
		<RecordChecklist {kind} {record} {focus} testCases={$store.testCases} />
		<div class="mt-5"><LinkedRecords {kind} {links} wide={width > 900} {onOpen} /></div>
		<h2 class="{heading} mt-5">Evidence</h2>
		<div class="h-[440px] ring-1 ring-surface-500/30">
			{#key `${kind}:${record.ID}`}
				<EvidenceViewer
					{store}
					requests={record.Requests ?? []}
					artifacts={record.Artifacts ?? []}
					listWidth={width > 1000 ? 300 : 240}
					stackPair={width < 860}
				/>
			{/key}
		</div>
	</div>
</div>
