<script context="module">
	import { writable } from "svelte/store";

	// The last format chosen, per noun, remembered for next time.
	const formatKey = (noun) => `marasi-app.attach-format.${noun}`;
	const remembered = new Map();
	function lastFormat(noun, fallback) {
		if (!remembered.has(noun)) {
			let saved = null;
			try {
				saved = localStorage.getItem(formatKey(noun));
			} catch {
				saved = null;
			}
			const store = writable(saved ?? fallback);
			store.subscribe((value) => {
				try {
					localStorage.setItem(formatKey(noun), value);
				} catch {
					// Remembering is a convenience; without storage it starts at the default.
				}
			});
			remembered.set(noun, store);
		}
		return remembered.get(noun);
	}
</script>

<script>
	// Attach… for a tool document: pick a finding or test case, and the
	// document goes there as an Artifact (attachments.js). Attaching again to
	// a record asks "Replace <file> on <record>?" and replaces only the
	// Artifact this document made. Opened through modalStore with
	// `component: { ref: AttachDialog, props: { documents, docId, noun,
	// formats, makeFile } }`; `makeFile(format)` builds the File to upload.
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { primaryVariant, neutralVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts.js";
	import { attachments, recordTitle } from "./toolItems.js";
	import { recordKey } from "./attachments.js";

	/** A toolDocuments collection. */
	export let documents;
	export let docId;
	export let noun = "drawing";
	/** [{ value, label }], or [] for a document with one format. The first is the default. */
	export let formats = [];
	/** (format) → Promise<File> */
	export let makeFile;
	/** Skeleton passes its modal's parent props; unused. */
	export const parent = undefined;

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const format = formats.length ? lastFormat(noun, formats[0].value) : writable(null);
	if (formats.length && !formats.some((f) => f.value === $format)) format.set(formats[0].value);

	let filter = "";
	let chosen = null;
	let confirming = null;
	let busy = false;

	$: doc = $documents.items.find((d) => d.id === docId);
	$: needle = filter.trim().toLowerCase();
	$: rows = [
		...$logbookStore.findings.map((record) => ({ kind: "finding", record })),
		...$logbookStore.testCases.map((record) => ({ kind: "testCase", record })),
	].filter(({ record }) => (record.Title ?? "").toLowerCase().includes(needle));
	$: if (!rows.some((row) => row.kind === chosen?.kind && String(row.record.ID) === String(chosen?.id))) chosen = null;

	const close = () => modalStore.close();
	const label = (kind) => (kind === "finding" ? "Finding" : "Test case");

	async function submit() {
		if (!chosen || !doc || busy) return;
		const earlier = attachments.previous(doc, chosen);
		if (earlier && !confirming) {
			confirming = { filename: earlier.filename, record: `${label(chosen.kind)} “${recordTitle(chosen.kind, chosen.id)}”` };
			return;
		}
		busy = true;
		try {
			const file = await makeFile($format);
			const attached = await attachments.attach(doc, chosen, file);
			documents.change(doc.id, { attached });
			toastStore.trigger({ message: `Attached ${file.name}`, background: "variant-filled-success" });
			close();
		} catch (err) {
			toastError(toastStore, "Attach failed", err);
			confirming = null;
		} finally {
			busy = false;
		}
	}
</script>

{#if $modalStore[0] && doc}
	<div class="card w-modal space-y-3 bg-surface-50 p-4 shadow-xl dark:bg-surface-800" data-testid="attach-dialog">
		<header class="text-base font-bold">Attach “{doc.name}”</header>
		{#if confirming}
			<p class="text-sm" data-testid="attach-replace">Replace {confirming.filename} on {confirming.record}?</p>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={() => (confirming = null)}>Back</button>
				<button type="button" class="btn btn-sm {primaryVariant($modeCurrent)}" disabled={busy} on:click={submit}>Replace</button>
			</div>
		{:else}
			<!-- svelte-ignore a11y-autofocus -->
			<input
				class="input text-xs"
				placeholder="Filter findings and test cases"
				aria-label="Filter findings and test cases"
				autofocus
				bind:value={filter}
				on:keydown={(event) => {
					if (event.key === "Enter" && chosen) submit();
				}}
			/>
			<ul class="max-h-72 overflow-auto text-xs" role="listbox" aria-label="Records">
				{#each rows as { kind, record } (`${kind}:${record.ID}`)}
					{@const on = chosen?.kind === kind && String(chosen?.id) === String(record.ID)}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={on}
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left {on ? 'bg-primary-500/20 font-semibold' : 'hover:bg-surface-500/15'}"
							data-testid="attach-record"
							on:click={() => (chosen = { kind, id: record.ID })}
							on:dblclick={() => {
								chosen = { kind, id: record.ID };
								submit();
							}}
						>
							<span class="w-16 shrink-0 opacity-60">{label(kind)}</span>
							<span class="min-w-0 flex-1 truncate">{record.Title || `Untitled ${label(kind).toLowerCase()}`}</span>
							{#if doc.attached?.[recordKey(kind, record.ID)]}<span class="shrink-0 opacity-60">attached</span>{/if}
						</button>
					</li>
				{:else}
					<li class="px-2 py-1.5 opacity-60">No findings or test cases</li>
				{/each}
			</ul>
			<div class="flex items-center gap-3">
				{#if formats.length}
					<div class="flex items-center gap-3 text-xs" role="radiogroup" aria-label="Format">
						{#each formats as option}
							<label class="flex items-center gap-1">
								<input type="radio" class="radio" name="attach-format" value={option.value} bind:group={$format} />
								{option.label}
							</label>
						{/each}
					</div>
				{/if}
				<div class="flex-1"></div>
				<button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={close}>Cancel</button>
				<button
					type="button"
					class="btn btn-sm {primaryVariant($modeCurrent)}"
					data-testid="attach-submit"
					disabled={!chosen || busy}
					on:click={submit}>{busy ? "Attaching…" : "Attach"}</button
				>
			</div>
		{/if}
	</div>
{/if}
