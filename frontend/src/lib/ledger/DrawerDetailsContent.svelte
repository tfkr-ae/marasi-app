<script>
	// Shared body of the Ledger drawer's expanded left details column and
	// narrow-mobile left details sidebar: pair facts, highlight swatches, note
	// preview + Add/Edit, linked records, and Prettify/Wrap view checkboxes.
	import { createEventDispatcher } from "svelte";
	import { Pencil, Sparkles, WrapText } from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import { WRAP_SUSPENDED } from "../lineWrap.js";
	import DrawerFacts from "./DrawerFacts.svelte";
	import DrawerHighlightSwatches from "./DrawerHighlightSwatches.svelte";
	import DrawerLinked from "./DrawerLinked.svelte";
	import { DRAWER_CONTEXT, noteIndicator } from "./drawerPresentation.js";

	export let pair;
	export let timing = "";
	export let palette = [];
	export let note = null;
	export let noteStatus = "saved";
	/** Whether the Note editor pane is currently active. */
	export let noteActive = false;
	export let findings = [];
	export let testCases = [];
	export let prettify = true;
	export let wrap = false;
	export let indexing = false;
	export let wrapPaused = false;
	/** Larger touch targets and active feedback for the narrow-mobile sidebar. */
	export let touch = false;

	const dispatch = createEventDispatcher();
	const INDEXING = "Indexing data: some bodies may not show prettified yet";

	$: keymap = $menuDispatcher;
	$: hasNote = note != null ? note.length > 0 : pair.Metadata?.has_note == 1;
	$: noteInfo = noteIndicator(noteStatus, hasNote, { active: noteActive });
	$: wrapShortcut = shortcutLabel(keymap, `${DRAWER_CONTEXT}.toggle-word-wrap`);

	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	$: rowClass = touch
		? "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs active:bg-surface-200-700-token"
		: "flex w-full items-center gap-2 whitespace-nowrap px-3 py-[5px] text-left hover:bg-surface-200-700-token";
	$: iconSize = touch ? 14 : 13;
	$: checkboxClass = touch ? "checkbox h-3.5 w-3.5" : "checkbox h-3 w-3";
</script>

<DrawerFacts {pair} {timing} prefix="ledger" />

<div class={heading}>Highlight</div>
<DrawerHighlightSwatches
	class="ledger-drawer-swatches flex flex-none flex-wrap {touch ? 'gap-2 px-3 py-1' : 'gap-1.5 px-3'}"
	{palette}
	selected={pair.Highlight}
	size={touch ? "touch" : "default"}
	surface="column"
	on:highlight
/>

<div
	class="ledger-drawer-note-heading flex items-center gap-2 {heading} {noteInfo.headingTint}"
	data-status={noteActive ? noteStatus : null}
>
	<span>Note</span>
	{#if noteInfo.headingText}
		<span class="ledger-note-status normal-case tracking-normal" role="status">{noteInfo.headingText}</span>
	{/if}
	<span class="flex-1"></span>
	<button
		type="button"
		class="ledger-drawer-note-edit flex items-center gap-1 normal-case tracking-normal text-primary-500 {touch
			? ''
			: 'hover:underline'}"
		on:click={() => dispatch("openNote")}
	>
		<Pencil size={10} />{hasNote ? "Edit" : "Add"}
	</button>
</div>
{#if note}
	<button
		type="button"
		class="ledger-drawer-note-preview mx-3 line-clamp-3 flex-none whitespace-pre-line break-words text-left text-2xs opacity-80 {touch
			? ''
			: 'hover:opacity-100'}"
		title="Open the note"
		on:click={() => dispatch("openNote")}>{note}</button
	>
{:else}
	<p class="mx-3 flex-none text-2xs opacity-40">{note === null ? "…" : "No note"}</p>
{/if}

<DrawerLinked {findings} {testCases} />

<div class={heading}>View</div>
<label class={rowClass} title={indexing ? INDEXING : null}>
	<span class="relative flex-none">
		<Sparkles size={iconSize} class={touch && prettify ? "text-primary-500" : "opacity-70"} />
		{#if indexing}
			<span class="ledger-drawer-indexing absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"></span>
		{/if}
	</span>
	<span class="flex-1">Prettify</span>
	<input type="checkbox" class={checkboxClass} bind:checked={prettify} />
</label>
<label class="{rowClass} {touch ? 'mb-3' : 'mb-2'}" title={wrapPaused ? WRAP_SUSPENDED : null}>
	<span class="relative flex-none">
		<WrapText size={iconSize} class={touch && wrap ? "text-primary-500" : "opacity-70"} />
		{#if wrapPaused}
			<span class="ledger-drawer-wrap-suspended absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"></span>
		{/if}
	</span>
	<span class="flex-1">Wrap lines</span>
	{#if wrapShortcut}
		<kbd class="text-3xs opacity-50">{wrapShortcut}</kbd>
	{/if}
	<input type="checkbox" class={checkboxClass} bind:checked={wrap} />
</label>
