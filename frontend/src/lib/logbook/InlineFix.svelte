<script>
	// One checklist item filled in place, over the Logbook store's inline
	// fix: text with ⌘↵ to save, the CVSS picker, a traffic search to link
	// requests, a test case pick or a category. Nothing is written until
	// Save; Cancel drops it. Esc in a field goes Back, which asks first when
	// there is input.
	import { createEventDispatcher, onDestroy, tick } from "svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { Save, Search, X } from "lucide-svelte";
	import { isDirty } from "../../stores/logbookStore.js";
	import { ledgerStore } from "../../stores/ledgerStore.js";
	import { createRequestPicker } from "../requestPicker.js";
	import { METHOD_CLASS, neutralVariant, primaryVariant } from "../launchpad/format.js";
	import CVSSCalculator from "../components/CVSSCalculator.svelte";
	import TestCasePicker from "./TestCasePicker.svelte";

	export let store;
	export let fix;
	export let testCases = [];

	const dispatch = createEventDispatcher();
	const TEXTS = {
		WriteUp: "What is wrong, where, and how to reproduce it",
		TreatmentPlan: "How to fix it",
		Note: "What you tried and what happened",
	};

	let box;
	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
	$: draft = fix.draft;
	$: dirty = isDirty(fix);
	$: categories = [...new Set(testCases.map((t) => t.Category?.trim()).filter(Boolean))].sort();

	// Add or edit focuses the field; arriving on an item does not.
	let focusedSeq = null;
	$: if (box && fix.focus && fix.seq !== focusedSeq) {
		focusedSeq = fix.seq;
		tick().then(() => box?.querySelector("textarea, input:not([disabled]), button[aria-pressed]")?.focus());
	}

	const save = () => dirty && !fix.saving && dispatch("save");

	function onKeydown(event) {
		const field = event.target?.closest?.("input, textarea");
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			save();
		} else if (event.key === "Escape" && field) {
			event.preventDefault();
			event.stopPropagation();
			dispatch("leave");
		}
	}

	// Requests: a traffic search; labels for the rows come from the search
	// or a read of the pair.
	const picker = createRequestPicker(ledgerStore.searchRequests);
	let q = "";
	let searching = false;
	let labels = {};
	$: picker.search(fix.item === "Requests" ? q : "");
	$: hits = $picker.filter((option) => !draft.Requests.includes(option.value)).slice(0, 10);
	$: if (fix.item === "Requests") draft.Requests.forEach(readLabel);
	onDestroy(() => picker.cancel());

	const labelOf = (r) => ({ number: r?.Number ?? null, method: r?.Method ?? "", url: `${r?.Host ?? ""}${r?.Path ?? ""}` });
	async function readLabel(id) {
		if (labels[id]) return;
		labels[id] = { number: null, method: "", url: "…" };
		const pair = await store.readPair(id).catch(() => null);
		labels[id] = pair ? labelOf(pair.Request) : { number: null, method: "", url: "Couldn't read this request" };
	}

	function link(option) {
		labels[option.value] = labelOf(option);
		store.linkFixRequest(option.value);
		q = "";
	}

	function onSearchKey(event) {
		if (event.key === "Enter" && !(event.metaKey || event.ctrlKey) && hits[0]) {
			event.preventDefault();
			link(hits[0]);
		}
	}
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div bind:this={box} class="logbook-fix space-y-2 px-3 pb-3 pt-1" data-fix={fix.item} on:keydown={onKeydown}>
	{#if TEXTS[fix.item]}
		<textarea
			class="textarea w-full rounded-token border-0 text-xs leading-relaxed"
			rows="5"
			placeholder={TEXTS[fix.item]}
			value={draft[fix.item] ?? ""}
			on:input={(e) => store.updateFix({ [fix.item]: e.currentTarget.value })}
		></textarea>
	{:else if fix.item === "Category"}
		<input
			class="input h-8 rounded-token border-0 py-1 text-xs"
			list="logbook-fix-categories"
			placeholder="e.g. Access Control"
			value={draft.Category ?? ""}
			on:input={(e) => store.updateFix({ Category: e.currentTarget.value })}
			on:keydown={(e) => e.key === "Enter" && (e.preventDefault(), save())}
		/>
		<datalist id="logbook-fix-categories">{#each categories as category}<option value={category} />{/each}</datalist>
	{:else if fix.item === "CVSSVector"}
		<CVSSCalculator
			vector={draft.CVSSVector ?? ""}
			open
			on:change={(e) => store.updateFix({ CVSSVector: e.detail.vector, CVSSScore: e.detail.score ?? 0 })}
		/>
	{:else if fix.item === "TestCaseID"}
		<TestCasePicker value={draft.TestCaseID} {testCases} on:change={(e) => store.updateFix({ TestCaseID: e.detail })} />
	{:else if fix.item === "Requests"}
		<div class="relative">
			<div class="flex h-8 items-center gap-2 rounded-token bg-surface-200-700-token px-2 focus-within:ring-1 focus-within:ring-primary-500/60">
				<Search size={12} class="flex-none opacity-60" />
				<input
					class="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-xs placeholder:opacity-60 focus:ring-0"
					placeholder="Search traffic to link (#12, host or path)"
					data-fix-search
					bind:value={q}
					on:focus={() => (searching = true)}
					on:blur={() => (searching = false)}
					on:keydown={onSearchKey}
				/>
			</div>
			{#if searching && q.trim()}
				<div class="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-container-token bg-surface-50 py-1 shadow-xl ring-1 ring-surface-500/30 dark:bg-surface-800">
					{#each hits as option (option.value)}
						{@const row = labelOf(option)}
						<button type="button" class="flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-[11px] hover:bg-primary-500/15" on:mousedown|preventDefault={() => link(option)}>
							<span class="w-10 flex-none opacity-60">#{row.number}</span>
							<span class="w-12 flex-none {METHOD_CLASS[row.method] ?? ''}">{row.method}</span>
							<span class="min-w-0 flex-1 truncate">{row.url}</span>
						</button>
					{:else}
						<p class="px-2 py-1 text-[11px] opacity-60">No matching traffic</p>
					{/each}
				</div>
			{/if}
		</div>
		{#each draft.Requests as id (id)}
			{@const row = labels[id] ?? {}}
			<div class="flex items-center gap-2 font-mono text-[11px]" data-fix-request={id}>
				<span class="w-10 flex-none opacity-60">{row.number != null ? `#${row.number}` : ""}</span>
				<span class="w-12 flex-none {METHOD_CLASS[row.method] ?? ''}">{row.method}</span>
				<span class="min-w-0 flex-1 truncate">{row.url}</span>
				{#if !fix.original.Requests.includes(id)}<span class="badge flex-none rounded-sm bg-primary-500/20 px-1 py-0 font-sans text-[10px]">new</span>{/if}
				<button type="button" class="flex-none p-0.5 opacity-70 hover:opacity-100" title="Unlink" aria-label="Unlink" on:click={() => store.unlinkFixRequest(id)}><X size={12} /></button>
			</div>
		{/each}
	{/if}
	<div class="flex items-center gap-2">
		<span class="min-w-0 flex-1 truncate text-[11px]">
			{#if fix.error}<span class="text-error-500" title={String(fix.error)}>Not saved: {String(fix.error)}</span>{/if}
		</span>
		<button type="button" class="btn btn-sm flex-none {neutral}" data-fix-cancel disabled={fix.saving} on:click={() => store.cancelFix()}>Cancel</button>
		<button type="button" class="btn btn-sm flex-none {primary}" data-fix-save disabled={!dirty || fix.saving} title="Save (⌘↵)" on:click={save}>
			<Save size={13} class="mr-1" />{fix.saving ? "Saving…" : "Save"}
		</button>
	</div>
</div>
