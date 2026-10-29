<script>
	// A finding or test case in the workspace: Back, its severity (or the
	// test-case icon) and title, then Next, Edit and Delete; below, what it
	// needs, its linked records and its evidence. An item filled in place
	// saves on its own; moving away from one with input asks first.
	import { tick } from "svelte";
	import { getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { ArrowLeft, ArrowRight, BookCheck, Pencil, Trash2 } from "lucide-svelte";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts.js";
	import { refreshOtherLists } from "./recordEditor.js";
	import EvidenceViewer from "./EvidenceViewer.svelte";
	import LinkedRecords from "./LinkedRecords.svelte";
	import RecordChecklist from "./RecordChecklist.svelte";
	import { SEVERITY_BADGE } from "./severityColors.js";
	import { ITEMS, linkedOf } from "../../stores/logbookStore";

	const ITEM_LABEL = Object.fromEntries([...ITEMS.finding, ...ITEMS.testCase].map((i) => [i.key, i.label]));

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
	let keepButton;
	const toastStore = getToastStore();

	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
	$: fix = $store.fix;
	$: leaving = !!fix?.leaving;
	$: if (leaving) tick().then(() => keepButton?.focus());

	async function saveFix() {
		const result = await store.saveFix();
		if (result.ok) {
			refreshOtherLists();
			if (result.done) toastStore.trigger({ message: `${result.kind === "finding" ? "Finding" : "Test case"} done`, background: "variant-filled-success" });
		} else if (result.error) toastError(toastStore, "Not saved", result.error);
	}
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
	const heading = "mb-1.5 text-3xs font-bold uppercase tracking-wider opacity-50";
</script>

<div class="logbook-record relative flex h-full min-h-0 flex-col" bind:clientWidth={width} data-kind={kind} data-id={record.ID}>
	<header class="flex h-12 flex-none items-center gap-2 border-b border-surface-500/30 px-4">
		<button id="logbookBack" class="btn btn-sm flex-none {primary}" title="Back to the list (Esc)" on:click={onBack}
			><ArrowLeft size={12} class="mr-1" />Back</button
		>
		{#if kind === "finding"}
			<span class="badge flex-none rounded-sm px-1.5 py-0.5 text-3xs font-bold {SEVERITY_BADGE[record.Severity] ?? 'variant-soft'}"
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
		<RecordChecklist {kind} {record} {store} {fix} testCases={$store.testCases} on:save={saveFix} on:leave={onBack} />
		<div class="mt-5"><LinkedRecords {kind} {links} wide={width > 900} {onOpen} /></div>
		<h2 class="{heading} mt-5">Evidence</h2>
		<div class="h-[27.5rem] ring-1 ring-surface-500/30">
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
	{#if leaving}
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div class="absolute inset-0 z-40 flex items-center justify-center bg-black/30" on:mousedown|self={() => store.keepFix()}>
			<div class="card w-[22.5rem] space-y-3 p-4 text-xs shadow-2xl bg-surface-50-800-token" role="alertdialog" aria-label="Unsaved changes" data-leave-prompt>
				<h3 class="text-base font-bold">Unsaved changes</h3>
				<p>Your changes to the {(ITEM_LABEL[fix.item] ?? "item").toLowerCase()} aren't saved.</p>
				<div class="flex justify-end gap-2 pt-1">
					<button bind:this={keepButton} type="button" class="btn btn-sm {neutral}" on:click={() => store.keepFix()}>Keep editing</button>
					<button type="button" class="btn btn-sm {primary}" on:click={() => store.discardFix()}>Discard</button>
				</div>
			</div>
		</div>
	{/if}
</div>
