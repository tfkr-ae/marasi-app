<script>
	// The Ledger drawer's left edge: a collapsed icon rail for pane & editor
	// view toggles (Note, Metadata, Prettify, Wrap lines) that expands via the
	// command strip's left corner toggle into the details column (pair facts,
	// highlight swatches, note preview, linked records, and view checkboxes).
	import { createEventDispatcher } from "svelte";
	import { Braces, Pencil, Sparkles, StickyNote, WrapText } from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import DrawerFacts from "./DrawerFacts.svelte";
	import DrawerLinked from "./DrawerLinked.svelte";
	import { DRAWER_CONTEXT, noteIndicator, shortcutTooltip } from "./drawerPresentation.js";
	import { WRAP_SUSPENDED } from "../lineWrap.js";

	/** The focused pair's table row. */
	export let pair;
	/** Whether the details column shows instead of the collapsed rail. */
	export let expanded = false;
	/** The highlight palette, [{ number, label, color }]. */
	export let palette = [];
	/** The pair's note, or null while it loads. */
	export let note = null;
	/** The open note's save state: "saved", "unsaved", "saving" or "failed". */
	export let noteStatus = "saved";
	/** Whether Marasi is still indexing prettified bodies, so some may show raw. */
	export let indexing = false;
	/** The findings and test cases that list the pair. */
	export let findings = [];
	export let testCases = [];
	/** "note" or "metadata" while one shows in place of the response. */
	export let pane = null;
	export let timing = "";
	export let prettify = true;
	export let wrap = false;
	/** Whether Wrap lines is on but a showing body has a line too long to wrap. */
	export let wrapPaused = false;

	const dispatch = createEventDispatcher();
	const DRAWER = DRAWER_CONTEXT;

	$: keymap = $menuDispatcher;
	$: hasNote = note != null ? note.length > 0 : pair.Metadata?.has_note == 1;
	$: noteInfo = noteIndicator(noteStatus, hasNote);
	$: wrapShortcut = shortcutLabel(keymap, `${DRAWER}.toggle-word-wrap`);

	const STATUS = { unsaved: "Edited", saving: "Saving…", failed: "Not saved" };
	// While the note is open, the column's Note heading follows the dot:
	// undimmed when saved, amber or red otherwise.
	$: noteTint =
		pane !== "note"
			? ""
			: noteStatus === "failed"
				? "text-error-500 !opacity-100"
				: noteStatus !== "saved"
					? "text-warning-500 !opacity-100"
					: "text-surface-900 dark:text-surface-50 !opacity-100";

	const INDEXING = "Indexing data: some bodies may not show prettified yet";
	const indexingDot = "absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-warning-500";

	const togglePane = (which) => dispatch("pane", pane === which ? null : which);
	const highlightLabel = (h) => (pair.Highlight === h.number ? `${h.label} (click to clear)` : h.label);

	const railButton = "flex h-7 w-8 flex-none items-center justify-center hover:bg-surface-200-700-token";
	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	const row = "flex w-full items-center gap-2 whitespace-nowrap px-3 py-[5px] text-left hover:bg-surface-200-700-token";
	const divider = "my-1 w-5 flex-none border-t border-surface-300-600-token";
</script>

{#if expanded}
	<aside
		class="ledger-drawer-column ledger-drawer-left-column flex w-56 flex-none flex-col overflow-y-auto border-r border-surface-300-600-token bg-surface-50 text-2xs dark:bg-surface-900"
		aria-label="Request details"
	>
		<DrawerFacts {pair} {timing} prefix="ledger" />

		<div class={heading}>Highlight</div>
		<div class="ledger-drawer-swatches flex flex-none flex-wrap gap-1.5 px-3" role="radiogroup" aria-label="Highlight">
			{#each palette as h (h.number)}
				<button
					type="button"
					class="h-3.5 w-3.5 rounded-full {pair.Highlight === h.number
						? 'ring-2 ring-surface-900 ring-offset-1 ring-offset-surface-50 dark:ring-surface-50 dark:ring-offset-surface-900'
						: ''}"
					style="background: {h.color}"
					role="radio"
					aria-checked={pair.Highlight === h.number}
					title={highlightLabel(h)}
					aria-label={h.label}
					data-highlight={h.number}
					on:click={() => dispatch("highlight", pair.Highlight === h.number ? null : h.number)}
				></button>
			{/each}
		</div>

		<div
			class="ledger-drawer-note-heading flex items-center gap-2 {heading} {noteTint}"
			data-status={pane === "note" ? noteStatus : null}
		>
			Note
			{#if pane === "note" && STATUS[noteStatus]}
				<span class="ledger-note-status normal-case tracking-normal" role="status">{STATUS[noteStatus]}</span>
			{/if}
			<span class="flex-1"></span>
			<button
				type="button"
				class="ledger-drawer-note-edit flex items-center gap-1 normal-case tracking-normal text-primary-500 hover:underline"
				on:click={() => dispatch("pane", "note")}><Pencil size={10} />{hasNote ? "Edit" : "Add"}</button
			>
		</div>
		{#if note}
			<button
				type="button"
				class="ledger-drawer-note-preview mx-3 line-clamp-3 flex-none whitespace-pre-line break-words text-left text-2xs opacity-80 hover:opacity-100"
				title="Open the note"
				on:click={() => dispatch("pane", "note")}>{note}</button
			>
		{:else}
			<p class="mx-3 flex-none text-2xs opacity-40">{note === null ? "…" : "No note"}</p>
		{/if}

		<DrawerLinked {findings} {testCases} />

		<div class={heading}>View</div>
		<label class={row} title={indexing ? INDEXING : null}>
			<span class="relative flex-none"
				><Sparkles size={13} class="opacity-70" />{#if indexing}<span
						class="ledger-drawer-indexing absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"
					></span>{/if}</span
			><span class="flex-1">Prettify</span>
			<input type="checkbox" class="checkbox h-3 w-3" bind:checked={prettify} />
		</label>
		<label class="{row} mb-2" title={wrapPaused ? WRAP_SUSPENDED : null}>
			<span class="relative flex-none"
				><WrapText size={13} class="opacity-70" />{#if wrapPaused}<span
						class="ledger-drawer-wrap-suspended absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"
					></span>{/if}</span
			><span class="flex-1">Wrap lines</span>
			{#if wrapShortcut}
				<kbd class="text-3xs opacity-50">{wrapShortcut}</kbd>
			{/if}
			<input type="checkbox" class="checkbox h-3 w-3" bind:checked={wrap} />
		</label>
	</aside>
{:else}
	<nav
		class="ledger-drawer-rail ledger-drawer-left-rail flex w-9 flex-none flex-col items-center border-r border-surface-300-600-token bg-surface-50 py-1 dark:bg-surface-900"
		aria-label="Panes and view"
	>
		<button
			type="button"
			class="ledger-drawer-note-toggle relative {railButton} {pane === 'note'
				? 'bg-surface-200-700-token text-primary-500'
				: ''}"
			title={shortcutTooltip(noteInfo.title, `${DRAWER}.view-note`, keymap)}
			aria-label="Note"
			data-status={noteStatus}
			aria-pressed={pane === "note"}
			on:click={() => togglePane("note")}
		>
			<StickyNote size={14} />
			{#if noteInfo.dot}
				<span class="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full {noteInfo.dot}"></span>
			{/if}
		</button>
		<button
			type="button"
			class="{railButton} {pane === 'metadata' ? 'bg-surface-200-700-token text-primary-500' : ''}"
			title={shortcutTooltip("Metadata", `${DRAWER}.view-metadata`, keymap)}
			aria-label="Metadata"
			aria-pressed={pane === "metadata"}
			on:click={() => togglePane("metadata")}
		>
			<Braces size={14} />
		</button>
		<div class={divider} aria-hidden="true"></div>
		<button
			type="button"
			class="relative {railButton} {prettify ? 'text-primary-500' : ''}"
			title={indexing ? `Prettify. ${INDEXING}` : "Prettify"}
			aria-label="Prettify"
			aria-pressed={prettify}
			on:click={() => (prettify = !prettify)}
		>
			<Sparkles size={14} />
			{#if indexing}<span class="ledger-drawer-indexing {indexingDot}"></span>{/if}
		</button>
		<button
			type="button"
			class="relative {railButton} {wrap ? 'text-primary-500' : ''}"
			title={wrapPaused
				? `${shortcutTooltip("Wrap lines", `${DRAWER}.toggle-word-wrap`, keymap)}. ${WRAP_SUSPENDED}`
				: shortcutTooltip("Wrap lines", `${DRAWER}.toggle-word-wrap`, keymap)}
			aria-label="Wrap lines"
			aria-pressed={wrap}
			on:click={() => (wrap = !wrap)}
		>
			<WrapText size={14} />
			{#if wrapPaused}<span class="ledger-drawer-wrap-suspended {indexingDot}"></span>{/if}
		</button>
	</nav>
{/if}
