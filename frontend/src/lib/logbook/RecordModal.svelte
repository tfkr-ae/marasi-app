<script>
	// The finding and test case modal, over the Logbook store's edit session.
	// The form is on the left, the evidence on the right. Nothing is written
	// until Save and close (or ⌘S). X, Esc and a click outside close a clean
	// session at once and ask on a dirty one (Keep editing, Discard, Save
	// and close); Esc on that prompt keeps editing.
	import { onDestroy, onMount, tick } from "svelte";
	import { get } from "svelte/store";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { BookCheck, Minimize2, Save, ShieldAlert, X } from "lucide-svelte";
	import { changesOf, logbookStore } from "../../stores/logbookStore.js";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { interceptModalEscape } from "../overlayIsolation.js";
	import { toastError } from "../toasts.js";
	import { refreshOtherLists, startFromOlderMeta } from "./recordEditor.js";
	import RecordForm from "./RecordForm.svelte";
	import RecordEvidence from "./RecordEvidence.svelte";

	/** Skeleton's modal props; unused. */
	export let parent = undefined;
	$: void parent;

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	let expanded = null;
	let titleInput;
	let keepButton;
	let seen = false;

	$: session = $logbookStore.session;
	$: finding = session?.kind === "finding";
	$: noun = finding ? "finding" : "test case";
	$: changes = changesOf(session);
	$: dirty = changes.length > 0;
	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
	$: expandedField = expanded && { WriteUp: "Writeup", TreatmentPlan: "Treatment plan", Note: "Note" }[expanded];

	// The session ending (Save, Discard, a clean close) closes the modal.
	$: if (session) seen = true;
	$: if (seen && !session && $modalStore.length) modalStore.close();
	$: if (session?.confirming) tick().then(() => keepButton?.focus());

	async function focusTitle() {
		expanded = null;
		await tick();
		titleInput?.focus();
	}

	function close() {
		logbookStore.requestClose();
	}

	async function saveAndClose() {
		if (!session || session.saving) return;
		if (!dirty && !session.isNew) return logbookStore.discard();
		const result = await logbookStore.save();
		if (result.ok) {
			const Noun = result.kind === "finding" ? "Finding" : "Test case";
			toastStore.trigger({ message: result.created ? `${Noun} created` : `${Noun} saved` });
			refreshOtherLists();
		} else if (result.reason === "title") {
			logbookStore.keepEditing();
			toastStore.trigger({ message: "Add a title first", background: "variant-filled-warning" });
			focusTitle();
		} else if (result.error) {
			toastError(toastStore, "Not saved", result.error);
		}
	}

	// Esc: the innermost thing gives way first.
	function onEscape() {
		if (session?.confirming) logbookStore.keepEditing();
		else if (expanded) expanded = null;
		else close();
	}

	// Skeleton closes a modal on any backdrop click; take the click over.
	function onBackdropPointer(event) {
		const backdrop = event.target?.classList?.contains("modal-backdrop") || event.target?.classList?.contains("modal-transition");
		if (!backdrop || !session) return;
		event.stopPropagation();
		if (event.type !== "mousedown") return;
		if (session.confirming) logbookStore.keepEditing();
		else close();
	}

	function onKeydown(event) {
		if (!session || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
		event.preventDefault();
		event.stopImmediatePropagation();
		saveAndClose();
	}

	let releaseEscape = () => {};
	onMount(() => {
		releaseEscape = interceptModalEscape(onEscape);
		window.addEventListener("mousedown", onBackdropPointer, true);
		window.addEventListener("mouseup", onBackdropPointer, true);
		window.addEventListener("keydown", onKeydown, true);
		// Older callers open it with a toggleAction, whose key would close it
		// without asking; only X, Esc and a click outside may close it.
		const opened = get(modalStore)[0];
		if (opened?.toggleAction) delete opened.toggleAction;
		const meta = opened?.meta;
		if (!session && meta) startFromOlderMeta(meta).catch((error) => toastError(toastStore, "Couldn't open", error));
		if (session?.isNew) focusTitle();
	});
	onDestroy(() => {
		releaseEscape();
		if (typeof window !== "undefined") {
			window.removeEventListener("mousedown", onBackdropPointer, true);
			window.removeEventListener("mouseup", onBackdropPointer, true);
			window.removeEventListener("keydown", onKeydown, true);
		}
		// The modal went some other way (another page took over): drop it.
		if ($logbookStore.session) logbookStore.discard();
	});
</script>

{#if session}
	<div
		class="card relative flex h-[92vh] w-[96vw] flex-col overflow-hidden rounded-none border-t-4 text-xs shadow-2xl bg-surface-50-800-token text-surface-900-50-token {finding
			? 'border-primary-500'
			: 'border-tertiary-500'}"
		data-record-modal={session.kind}
	>
		<header class="flex flex-none items-center gap-2 border-b border-surface-500/30 px-3 py-2">
			{#if finding}<ShieldAlert size={16} class="flex-none text-primary-500" />{:else}<BookCheck size={16} class="flex-none text-tertiary-500" />{/if}
			<h2 class="flex-none text-base font-bold">{session.isNew ? "New" : "Edit"} {noun}</h2>
			{#if dirty}<span class="flex-none text-[10px] text-warning-800 dark:text-warning-500" title="Unsaved changes" data-unsaved-mark>● Unsaved</span>{/if}
			<span class="flex-1"></span>
			<button type="button" class="flex-none p-1 opacity-60 hover:opacity-100" title="Close (Esc)" aria-label="Close" on:click={close}><X size={16} /></button>
		</header>

		<div class="flex min-h-0 flex-1" class:hidden={!!expanded}>
			<section class="flex w-[480px] flex-none flex-col gap-4 overflow-auto border-r border-surface-500/30 p-4">
				<RecordForm {session} bind:expanded bind:titleInput />
			</section>
			<section class="flex min-w-0 flex-1 flex-col">
				<RecordEvidence {session} />
			</section>
		</div>
		{#if expanded}
			<div class="flex min-h-0 flex-1 flex-col gap-2 p-4" data-expanded={expanded}>
				<div class="flex items-center">
					<span class="flex-1 truncate text-sm font-bold">{session.draft.Title || `Untitled ${noun}`} <span class="font-normal opacity-60">· {expandedField}</span></span>
					<button type="button" class="flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100" on:click={() => (expanded = null)}><Minimize2 size={11} />Collapse</button>
				</div>
				<!-- svelte-ignore a11y-autofocus -->
				<textarea
					autofocus
					data-field={expanded}
					class="textarea min-h-0 w-full flex-1 resize-none rounded-token border-0 p-4 text-xs leading-relaxed"
					value={session.draft[expanded] ?? ""}
					on:input={(e) => logbookStore.updateDraft({ [expanded]: e.currentTarget.value })}
				></textarea>
			</div>
		{/if}

		<footer class="flex flex-none items-center gap-2 border-t border-surface-500/30 px-3 py-2">
			<div class="min-w-0 flex-1 truncate text-[11px]" data-unsaved-list>
				{#if session.error}
					<span class="text-error-500" title={String(session.error)}>Not saved: {String(session.error)}</span>
				{:else if dirty}
					<span class="text-warning-800 dark:text-warning-500">●</span>
					<span class="opacity-80" title={changes.join(", ")}>Unsaved: {changes.join(", ")}</span>
				{:else}
					<span class="opacity-50">{session.isNew ? "Nothing entered yet" : "No changes"}</span>
				{/if}
			</div>
			<button type="button" class="btn btn-sm flex-none {neutral}" disabled={session.saving} on:click={() => logbookStore.discard()}>Close without saving</button>
			<button type="button" class="btn btn-sm flex-none {primary}" disabled={!dirty || session.saving} title="Save and close (⌘S)" data-save on:click={saveAndClose}>
				<Save size={13} class="mr-1" />{session.saving ? "Saving…" : "Save and close"}
			</button>
		</footer>

		{#if session.confirming}
			<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
			<div class="absolute inset-0 z-50 flex items-center justify-center bg-black/30" on:mousedown|self={() => logbookStore.keepEditing()}>
				<div class="card w-[400px] space-y-3 p-4 text-xs shadow-2xl bg-surface-50-800-token" role="alertdialog" aria-label="Unsaved changes" data-close-prompt>
					<h3 class="text-base font-bold">Unsaved changes</h3>
					<p>
						{#if session.isNew}
							<b>{session.draft.Title || `This ${noun}`}</b> hasn't been saved.
						{:else}
							Your changes to <b>{session.draft.Title || `this ${noun}`}</b> haven't been saved.
						{/if}
					</p>
					<div class="flex flex-wrap gap-1">
						{#each changes as change}<span class="badge rounded-sm px-1.5 py-0.5 text-[10px] variant-soft">{change}</span>{/each}
					</div>
					<div class="flex justify-end gap-2 pt-1">
						<button bind:this={keepButton} type="button" class="btn btn-sm {neutral}" on:click={() => logbookStore.keepEditing()}>Keep editing</button>
						<button type="button" class="btn btn-sm {neutral}" on:click={() => logbookStore.discard()}>Discard</button>
						<button type="button" class="btn btn-sm {primary}" on:click={saveAndClose}>Save and close</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
