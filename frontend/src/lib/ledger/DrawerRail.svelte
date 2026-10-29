<script>
	// The Ledger drawer's left edge: a thin icon rail that expands into a
	// details column. The rail keeps the drawer's own controls at the top and
	// scrolls its actions when the drawer is short. The column shows the
	// pair's facts, its highlight, a read-only preview of its note, what it is
	// linked to, the actions with their shortcuts, and the view toggles.
	// Actions are dispatched as `action` with their catalog action id, for the
	// page to run with its own handlers.
	import { createEventDispatcher, onDestroy, tick } from "svelte";
	import {
		BookCheck,
		Braces,
		ChevronDown,
		ChevronUp,
		Copy,
		FileOutput,
		Globe,
		Link,
		Maximize2,
		Minimize2,
		PanelLeftClose,
		PanelLeftOpen,
		Pencil,
		Radio,
		Send,
		ShieldAlert,
		Sparkles,
		StickyNote,
		Swords,
		WrapText,
		X,
	} from "lucide-svelte";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import DrawerFacts from "./DrawerFacts.svelte";
	import DrawerLinked from "./DrawerLinked.svelte";
	import { WRAP_SUSPENDED } from "../lineWrap.js";

	/** The focused pair's table row, and its request number. */
	export let pair;
	export let number;
	/** Whether the details column shows instead of the rail. */
	export let expanded = false;
	export let maximised = false;
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
	/** Whether the pair is a WebSocket upgrade whose stream can open. */
	export let canOpenStream = false;

	const dispatch = createEventDispatcher();
	const DRAWER = "ledger.drawer-open";

	// The pair actions, in groups; null separates them.
	$: actions = [
		...(canOpenStream
			? [{ label: "Open WebSocket stream", icon: Radio, actionId: `${DRAWER}.websocket.open-stream` }, null]
			: []),
		{ label: "Copy request", icon: Copy, actionId: `${DRAWER}.copy-raw-request` },
		{ label: "Copy response", icon: FileOutput, actionId: `${DRAWER}.copy-raw-response` },
		{ label: "Copy URL", icon: Link, actionId: `${DRAWER}.copy-url` },
		{ label: "Copy browser view URL", icon: Globe, actionId: `${DRAWER}.copy-browser-view-url` },
		null,
		{ label: "Send to Launchpad", icon: Send, actionId: `${DRAWER}.send-to-launchpad` },
		{ label: "Send to Armory", icon: Swords, actionId: `${DRAWER}.send-to-armory` },
		{ label: "Create finding", icon: ShieldAlert, actionId: `${DRAWER}.create-finding` },
		{ label: "Create test case", icon: BookCheck, actionId: `${DRAWER}.create-test-case` },
	];

	// "Label (⌘⇧R)", or the label alone when the action has no shortcut.
	function tip(label, actionId, keymap) {
		const key = shortcutLabel(keymap, actionId);
		return key ? `${label} (${key})` : label;
	}
	$: keymap = $menuDispatcher;
	$: hasNote = note != null ? note.length > 0 : pair.Metadata?.has_note == 1;
	$: maximiseLabel = maximised ? "Restore the table" : "Maximise the drawer";
	$: ExpandIcon = expanded ? PanelLeftClose : PanelLeftOpen;

	// The note button's dot: neutral grey when the pair has a note (the
	// primary colour is red, so it would read as the failure), amber while
	// an edit is unsaved or saving, red when a save failed (closing the
	// note, or the next edit, tries again).
	$: noteDot =
		noteStatus === "failed"
			? "bg-error-500"
			: noteStatus !== "saved"
				? "bg-warning-500"
				: hasNote
					? "bg-surface-500 dark:bg-surface-300"
					: "";
	$: noteTitle =
		noteStatus === "failed"
			? "Note not saved: close it or keep typing to try again"
			: noteStatus === "saving"
				? "Saving the note…"
				: noteStatus === "unsaved"
					? "Note edited"
					: hasNote
						? "Note"
						: "Add a note";
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

	// The rail's action list fades out at whichever edge cuts an action off.
	let list;
	let fadeTop = false;
	let fadeBottom = false;
	function measureFade() {
		if (!list) return;
		fadeTop = list.scrollTop > 0;
		fadeBottom = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
	}
	const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureFade);
	$: if (list && resizes) resizes.observe(list);
	$: actions, expanded, tick().then(measureFade);
	onDestroy(() => resizes?.disconnect());
	$: fadeMask = `linear-gradient(to bottom, transparent, black ${fadeTop ? 16 : 0}px, black calc(100% - ${fadeBottom ? 16 : 0}px), transparent)`;

	const togglePane = (which) => dispatch("pane", pane === which ? null : which);
	const run = (actionId) => dispatch("action", actionId);
	const highlightLabel = (h) => (pair.Highlight === h.number ? `${h.label} (click to clear)` : h.label);

	const railButton = "flex h-7 w-8 flex-none items-center justify-center rounded-sm hover:bg-surface-200-700-token";
	const headerButton = "flex h-6 w-6 flex-none items-center justify-center rounded-sm hover:bg-surface-200-700-token";
	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	const row = "flex w-full items-center gap-2 whitespace-nowrap px-3 py-[5px] text-left hover:bg-surface-200-700-token";
	const divider = "my-1 w-5 flex-none border-t border-surface-300-600-token";
</script>

{#if expanded}
	<aside
		class="ledger-drawer-column flex w-60 flex-none flex-col overflow-y-auto border-r border-surface-300-600-token bg-surface-50 text-2xs dark:bg-surface-900"
		aria-label="Request details"
	>
		<div class="flex h-7 flex-none flex-nowrap items-center gap-0.5 border-b border-surface-300-600-token px-2">
			<button
				class="ledger-drawer-expand {headerButton}"
				title="Collapse the details to the rail"
				aria-label="Collapse the details"
				aria-expanded="true"
				on:click={() => dispatch("expand", false)}><svelte:component this={ExpandIcon} size={14} /></button
			>
			<span class="min-w-0 flex-1 truncate pl-1 font-mono text-2xs opacity-60">#{number}</span>
			<button
				class={headerButton}
				title={tip("Previous request", `${DRAWER}.previous-request`, keymap)}
				aria-label="Previous request"
				on:click={() => dispatch("step", -1)}><ChevronUp size={14} /></button
			>
			<button
				class={headerButton}
				title={tip("Next request", `${DRAWER}.next-request`, keymap)}
				aria-label="Next request"
				on:click={() => dispatch("step", 1)}><ChevronDown size={14} /></button
			>
			<button
				class={headerButton}
				title={tip(maximiseLabel, `${DRAWER}.toggle-fullscreen`, keymap)}
				aria-label={maximiseLabel}
				aria-pressed={maximised}
				on:click={() => dispatch("maximise")}
			>
				{#if maximised}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
			</button>
			<button class={headerButton} title="Close (Esc)" aria-label="Close the drawer" on:click={() => dispatch("close")}
				><X size={14} /></button
			>
		</div>

		<DrawerFacts {pair} {timing} prefix="ledger" />

		<div class={heading}>Highlight</div>
		<div class="ledger-drawer-swatches flex flex-none flex-wrap gap-1 px-3" role="radiogroup" aria-label="Highlight">
			{#each palette as h (h.number)}
				<button
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
				class="ledger-drawer-note-edit flex items-center gap-1 normal-case tracking-normal text-primary-500 hover:underline"
				on:click={() => dispatch("pane", "note")}><Pencil size={10} />{hasNote ? "Edit" : "Add"}</button
			>
		</div>
		{#if note}
			<button
				class="ledger-drawer-note-preview mx-3 line-clamp-3 flex-none whitespace-pre-line break-words text-left text-2xs opacity-80 hover:opacity-100"
				title="Open the note"
				on:click={() => dispatch("pane", "note")}>{note}</button
			>
		{:else}
			<p class="mx-3 flex-none text-2xs opacity-40">{note === null ? "…" : "No note"}</p>
		{/if}

		<DrawerLinked {findings} {testCases} />

		<div class={heading}>Actions</div>
		{#each actions as action}
			{#if action}
				<button class={row} on:click={() => run(action.actionId)}>
					<svelte:component this={action.icon} size={13} class="flex-none opacity-70" />
					<span class="flex-1">{action.label}</span>
					<kbd class="text-3xs opacity-50">{shortcutLabel(keymap, action.actionId)}</kbd>
				</button>
			{:else}
				<div class="mx-3 my-1 flex-none border-t border-surface-300-600-token"></div>
			{/if}
		{/each}
		<button class="{row} {pane === 'metadata' ? 'text-primary-500' : ''}" on:click={() => togglePane("metadata")}>
			<Braces size={13} class="flex-none opacity-70" />
			<span class="flex-1">Metadata</span>
			<kbd class="text-3xs opacity-50">{shortcutLabel(keymap, `${DRAWER}.view-metadata`)}</kbd>
		</button>

		<div class={heading}>View</div>
		<label class={row} title={indexing ? INDEXING : null}>
			<span class="relative flex-none"
				><Sparkles size={13} class="opacity-70" />{#if indexing}<span
						class="ledger-drawer-indexing absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"
					></span>{/if}</span
			><span class="flex-1">Pretty</span>
			<input type="checkbox" class="checkbox h-3 w-3" bind:checked={prettify} />
		</label>
		<label class="{row} mb-2" title={wrapPaused ? WRAP_SUSPENDED : null}>
			<span class="relative flex-none"
				><WrapText size={13} class="opacity-70" />{#if wrapPaused}<span
						class="ledger-drawer-wrap-suspended absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"
					></span>{/if}</span
			><span class="flex-1">Wrap lines</span>
			<kbd class="text-3xs opacity-50">{shortcutLabel(keymap, `${DRAWER}.toggle-word-wrap`)}</kbd>
			<input type="checkbox" class="checkbox h-3 w-3" bind:checked={wrap} />
		</label>
	</aside>
{:else}
	<nav
		class="ledger-drawer-rail flex w-9 flex-none flex-col items-center border-r border-surface-300-600-token bg-surface-50 pb-0.5 dark:bg-surface-900"
		aria-label="Request actions"
	>
		<button
			class="ledger-drawer-expand {railButton}"
			title="Show the details"
			aria-label="Show the details"
			aria-expanded="false"
			on:click={() => dispatch("expand", true)}><svelte:component this={ExpandIcon} size={14} /></button
		>
		<button class={railButton} title="Close (Esc)" aria-label="Close the drawer" on:click={() => dispatch("close")}
			><X size={14} /></button
		>
		<button
			class={railButton}
			title={tip(maximiseLabel, `${DRAWER}.toggle-fullscreen`, keymap)}
			aria-label={maximiseLabel}
			aria-pressed={maximised}
			on:click={() => dispatch("maximise")}
		>
			{#if maximised}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
		</button>
		<button
			class={railButton}
			title={tip("Previous request", `${DRAWER}.previous-request`, keymap)}
			aria-label="Previous request"
			on:click={() => dispatch("step", -1)}><ChevronUp size={14} /></button
		>
		<button
			class={railButton}
			title={tip("Next request", `${DRAWER}.next-request`, keymap)}
			aria-label="Next request"
			on:click={() => dispatch("step", 1)}><ChevronDown size={14} /></button
		>
		<div class={divider}></div>
		<div
			class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto [scrollbar-width:none]"
			style="mask-image: {fadeMask}; -webkit-mask-image: {fadeMask}"
			data-fade="{fadeTop ? 'top' : ''}{fadeTop && fadeBottom ? ' ' : ''}{fadeBottom ? 'bottom' : ''}"
			bind:this={list}
			on:scroll={measureFade}
		>
			{#each actions as action}
				{#if action}
					<button
						class={railButton}
						title={tip(action.label, action.actionId, keymap)}
						aria-label={action.label}
						on:click={() => run(action.actionId)}><svelte:component this={action.icon} size={14} /></button
					>
				{:else}
					<div class={divider}></div>
				{/if}
			{/each}
			<div class={divider}></div>
			<button
				class="ledger-drawer-note-toggle relative {railButton} {pane === 'note' ? 'text-primary-500' : ''}"
				title={tip(noteTitle, `${DRAWER}.view-note`, keymap)}
				aria-label="Note"
				data-status={noteStatus}
				aria-pressed={pane === "note"}
				on:click={() => togglePane("note")}
			>
				<StickyNote size={14} />
				{#if noteDot}<span class="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full {noteDot}"></span>{/if}
			</button>
			<button
				class="{railButton} {pane === 'metadata' ? 'text-primary-500' : ''}"
				title={tip("Metadata", `${DRAWER}.view-metadata`, keymap)}
				aria-label="Metadata"
				aria-pressed={pane === "metadata"}
				on:click={() => togglePane("metadata")}><Braces size={14} /></button
			>
			<div class={divider}></div>
			<button
				class="relative {railButton} {prettify ? 'text-primary-500' : ''}"
				title={indexing ? `Prettify. ${INDEXING}` : "Prettify"}
				aria-label="Prettify"
				aria-pressed={prettify}
				on:click={() => (prettify = !prettify)}
				><Sparkles size={14} />{#if indexing}<span class="ledger-drawer-indexing {indexingDot}"></span>{/if}</button
			>
			<button
				class="relative {railButton} {wrap ? 'text-primary-500' : ''}"
				title={wrapPaused
					? `${tip("Wrap lines", `${DRAWER}.toggle-word-wrap`, keymap)}. ${WRAP_SUSPENDED}`
					: tip("Wrap lines", `${DRAWER}.toggle-word-wrap`, keymap)}
				aria-label="Wrap lines"
				aria-pressed={wrap}
				on:click={() => (wrap = !wrap)}
				><WrapText size={14} />{#if wrapPaused}<span class="ledger-drawer-wrap-suspended {indexingDot}"></span>{/if}</button
			>
		</div>
	</nav>
{/if}
