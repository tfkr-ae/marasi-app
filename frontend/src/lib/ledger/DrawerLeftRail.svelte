<script>
	// The Ledger drawer's left edge: a collapsed icon rail for pane & editor
	// view toggles (Note, Metadata, Prettify, Wrap lines) that expands via the
	// command strip's left corner toggle into the details column (pair facts,
	// highlight swatches, note preview, linked records, and view checkboxes).
	import { createEventDispatcher } from "svelte";
	import { Braces, Sparkles, StickyNote, WrapText } from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import DrawerDetailsContent from "./DrawerDetailsContent.svelte";
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

	const INDEXING = "Indexing data: some bodies may not show prettified yet";
	const indexingDot = "absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-warning-500";
	const togglePane = (which) => dispatch("pane", pane === which ? null : which);

	const railButton = "flex h-7 w-8 flex-none items-center justify-center hover:bg-surface-200-700-token";
	const divider = "my-1 w-5 flex-none border-t border-surface-300-600-token";
</script>

{#if expanded}
	<aside
		class="ledger-drawer-column ledger-drawer-left-column flex w-56 flex-none flex-col overflow-y-auto border-r border-surface-300-600-token bg-surface-50 text-2xs dark:bg-surface-900"
		aria-label="Request details"
	>
		<DrawerDetailsContent
			{pair}
			{timing}
			{palette}
			{note}
			{noteStatus}
			noteActive={pane === "note"}
			{findings}
			{testCases}
			{indexing}
			{wrapPaused}
			bind:prettify
			bind:wrap
			on:highlight
			on:openNote={() => dispatch("pane", "note")}
		/>
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
