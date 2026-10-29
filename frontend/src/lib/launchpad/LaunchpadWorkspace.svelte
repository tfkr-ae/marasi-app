<script>
	// The Launchpad workspace: top bar, then the Launchpad draft and the
	// selected entry's response side by side at full width. It reads the
	// store and calls its methods; confirmations belong to the page.
	import CodeMirror from "svelte-codemirror-editor";
	import { StreamLanguage } from "@codemirror/language";
	import { http } from "@codemirror/legacy-modes/mode/http";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import { modeCurrent, ProgressRadial, SlideToggle } from "@skeletonlabs/skeleton";
	import { Check, GitCompare, Globe, Pencil, RotateCcw, Send, Trash2, X } from "lucide-svelte";
	import { lineWrap, marasiConfig } from "../../stores";
	import { WRAP_SUSPENDED } from "../lineWrap.js";
	import { longStrings } from "../longStrings.js";
	import { isDraftDirty, launchOf, pendingLaunchOf } from "../../stores/launchpadStore";
	import { DELETE_LAUNCHPAD_PENDING_HINT } from "../launchPending.js";
	import { browserViewRefusal } from "../browserView.js";
	import { compareView } from "./compare.js";
	import { launchEndText, primaryVariant, statusClass } from "./format.js";
	import LaunchpadCompare from "./LaunchpadCompare.svelte";

	export let store;
	export let onEditorFocus = () => {};
	export let onLaunch = () => {};
	export let onCancel = () => {};
	export let onDelete = () => {};
	export let onBrowserView = () => {};
	export let launchDisabled = false;

	$: state = $store;
	$: launchpadId = state.selectedLaunchpadId;
	$: launchpad = state.launchpads.find((item) => item.ID === launchpadId);
	$: entries = state.entriesByLaunchpad[launchpadId] || [];
	$: draft = state.draftsByLaunchpad[launchpadId];
	$: selectedId = state.selectedEntryByLaunchpad[launchpadId];
	$: entryIndex = entries.findIndex((entry) => entry.ID === selectedId);
	$: details = selectedId ? state.detailsById[selectedId] : null;
	$: browserViewOff = browserViewRefusal(entries[entryIndex]);
	$: dirty = isDraftDirty(state, launchpadId);
	$: pending = !!pendingLaunchOf(state, launchpadId);
	$: endText = selectedId ? launchEndText(launchOf(state, selectedId)) : null;
	$: primary = primaryVariant($modeCurrent);
	$: theme = $modeCurrent ? githubLight : oneDark;
	$: vimExtensions = $marasiConfig.VimEnabled ? [vim()] : [];
	// Long strings fold in both editors; the panes' titles say when a shown
	// one stopped the lines wrapping.
	let draftPaused = false;
	let responsePaused = false;
	const onDraftSuspend = (suspended) => (draftPaused = suspended);
	const onResponseSuspend = (suspended) => (responsePaused = suspended);
	$: draftExtensions = [...vimExtensions, longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode, onSuspend: onDraftSuspend })];
	$: responseExtensions = [
		...vimExtensions,
		longStrings({ wrap: $lineWrap, mode: $marasiConfig.WrapMode, onSuspend: onResponseSuspend }),
	];
	$: compare = compareView(state);
	$: comparing = !!compare?.comparing;

	let comparePane;
	/**
	 * Starts compare from the selected entry (or the latest) as A, or closes
	 * it. Needs at least two entries.
	 */
	export function toggleCompare() {
		if (compare) return store.closeCompare();
		if (entries.length < 2) return;
		store.startCompare(selectedId ?? entries[entries.length - 1].ID);
	}
	/** Flips the diff between Request and Response while comparing. */
	export function toggleCompareView() {
		comparePane?.toggleTab();
	}

	// Mirrors RequestResponseView: the Syntax setting, with "auto" skipping
	// highlighting on very large bodies.
	function lang(body) {
		switch ($marasiConfig.SyntaxMode) {
			case "disabled":
				return undefined;
			case "auto":
				return (body ?? "").length < 75000 ? StreamLanguage.define(http) : undefined;
			default:
				return StreamLanguage.define(http);
		}
	}

	let editing = false;
	let nameInput = "";
	let descriptionInput = "";
	let nameField;
	/** Opens inline rename and description editing for the open launchpad. */
	export function startEdit() {
		if (!launchpad) return;
		nameInput = launchpad.Name;
		descriptionInput = launchpad.Description;
		editing = true;
		queueMicrotask(() => nameField?.focus());
	}
	export function toggleEdit() {
		if (editing) editing = false;
		else startEdit();
	}
	async function saveEdit() {
		await store.updateLaunchpad(launchpadId, {
			name: nameInput.trim() || launchpad.Name,
			description: descriptionInput.trim(),
		});
		editing = false;
	}
	function onEditKey(event) {
		if (event.key === "Enter") saveEdit();
		if (event.key === "Escape") editing = false;
	}
	$: launchpadId, (editing = false);
	// Rename… in the launchpad menu can rename this launchpad while the edit
	// is open; the name input follows, so saving doesn't restore the old name.
	let shownName;
	$: followName(launchpad?.Name);
	function followName(name) {
		if (name === shownName) return;
		if (editing) nameInput = name;
		shownName = name;
	}
</script>

{#if !launchpad}
	<div class="flex h-full flex-col items-center justify-center opacity-60">
		<h3 class="text-xl font-bold">No launchpad selected</h3>
		<p class="text-sm">Create one with + in the sidebar, or send a request from the Ledger.</p>
	</div>
{:else}
	<div class="flex h-full min-h-0 flex-col">
		<header class="lp-topbar flex items-center gap-3 border-b border-surface-500/30 bg-surface-50 px-3 py-2 dark:bg-surface-900">
			<div class="min-w-0 flex-1">
				{#if editing}
					<div class="flex items-center gap-2">
						<input
							bind:this={nameField}
							class="input h-8 w-56 text-sm font-bold"
							bind:value={nameInput}
							placeholder="Launchpad name"
							aria-label="Launchpad name"
							on:keydown={onEditKey}
						/>
						<input
							class="input h-8 flex-1 text-sm"
							bind:value={descriptionInput}
							placeholder="Description"
							aria-label="Launchpad description"
							on:keydown={onEditKey}
						/>
						<button class="btn btn-sm {primary} px-2" aria-label="Save" title="Save" on:click={saveEdit}>
							<Check size={16} />
						</button>
						<button class="btn btn-sm variant-soft px-2" aria-label="Cancel" title="Cancel" on:click={() => (editing = false)}>
							<X size={16} />
						</button>
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<h2 class="truncate text-base font-bold">{launchpad.Name}</h2>
						<button
							class="opacity-50 hover:opacity-100"
							aria-label="Rename launchpad"
							title="Rename and describe"
							on:click={startEdit}
						>
							<Pencil size={14} />
						</button>
					</div>
					<p class="truncate text-xs opacity-60">
						{launchpad.Description || "No description"}
						{#if entries.length > 0}
							· entry {entryIndex + 1} of {entries.length}
						{/if}
					</p>
				{/if}
			</div>

			{#if dirty && !comparing}
				<button
					class="btn btn-sm variant-soft-warning"
					title="Revert the draft to the entry it was seeded from"
					on:click={() => store.revertDraft(launchpadId)}
				>
					<RotateCcw size={14} class="mr-1" /> Revert draft
				</button>
			{/if}
			<button
				class="lp-compare-toggle btn btn-sm {compare ? primary : 'variant-soft'}"
				disabled={!compare && entries.length < 2}
				title={entries.length < 2 ? "Compare needs at least two entries" : compare ? "Close compare (Esc)" : "Compare the selected entry with another"}
				on:click={toggleCompare}
			>
				<GitCompare size={14} class="mr-1" />
				{compare ? "Close compare" : "Compare"}
			</button>
			<div class="flex items-center gap-2">
				<span class="text-sm font-bold">HTTPS</span>
				<SlideToggle
					name="TLS Toggle"
					size="sm"
					checked={draft?.useHttps ?? true}
					on:change={(e) => store.setUseHttps(launchpadId, e.target.checked)}
				/>
			</div>
			{#if pending}
				<button class="lp-cancel btn btn-sm {primary}" title="Cancel the pending launch" on:click={onCancel}>
					<ProgressRadial width="w-4" stroke={100} meter={$modeCurrent ? "stroke-primary-500" : "stroke-surface-50"} track="stroke-surface-500/30" />
					<span class="ml-2">Cancel</span>
				</button>
			{:else}
				<button class="lp-launch btn btn-sm {primary}" disabled={!draft || launchDisabled} on:click={onLaunch}>
					<Send size={14} class="mr-2" /> Launch
				</button>
			{/if}
			<button
				class="btn btn-sm variant-soft px-2"
				aria-label="Delete launchpad"
				title={pending ? DELETE_LAUNCHPAD_PENDING_HINT : "Delete launchpad"}
				disabled={pending}
				on:click={onDelete}
			>
				<Trash2 size={16} />
			</button>
		</header>

		<LaunchpadCompare bind:this={comparePane} {store} />
		<div class="grid min-h-0 flex-1 grid-cols-2" class:hidden={comparing}>
			<section class="flex min-h-0 min-w-0 flex-col border-r border-surface-500/30">
				<div class="flex items-center justify-between border-b border-surface-500/30 bg-surface-50 px-3 py-1 text-xs dark:bg-surface-900">
					<span class="lp-request-title font-bold">
						{dirty ? "Request draft" : "Request"}
						{#if dirty}<span class="ml-1 text-warning-500" title="Unsaved draft">●</span>{/if}
					</span>
					{#if draftPaused}
						<span class="lp-wrap-suspended opacity-60" title={WRAP_SUSPENDED}>Not wrapped</span>
					{/if}
				</div>
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div class="lp-editor lp-scroll min-h-0 flex-1 overflow-auto dark:bg-[#282c34]" on:focusin={onEditorFocus}>
					{#key launchpadId}
						<CodeMirror
							value={draft?.raw ?? ""}
							nodebounce
							on:change={(e) => store.updateDraft(launchpadId, e.detail)}
							class="text-xs"
							styles={{ "&": { fontSize: "0.6875rem" } }}
							lang={lang(draft?.raw)}
							{theme}
							extensions={draftExtensions}
						/>
					{/key}
				</div>
			</section>
			<section class="flex min-h-0 min-w-0 flex-col">
				<div class="flex items-center justify-between border-b border-surface-500/30 bg-surface-50 px-3 py-1 text-xs dark:bg-surface-900">
					<span class="font-bold">
						Response
						{#if details?.Response}
							· <span class={statusClass(details.Response.StatusCode)}>{details.Response.StatusCode}</span>
							· {details.Response.Length} B
						{/if}
						{#if details?.Response && responsePaused}
							<span class="lp-wrap-suspended font-normal opacity-60" title={WRAP_SUSPENDED}>· Not wrapped</span>
						{/if}
					</span>
					{#if selectedId}
						<button
							class="lp-browser-view flex items-center gap-1 opacity-60 hover:opacity-100 disabled:opacity-30"
							title={browserViewOff ?? "Copy the URL that shows this response in a browser that uses Marasi's proxy"}
							disabled={!!browserViewOff}
							on:click={onBrowserView}
						>
							<Globe size={12} /> Browser view
						</button>
					{/if}
				</div>
				<div class="lp-response lp-scroll min-h-0 flex-1 overflow-auto dark:bg-[#282c34]">
					{#if endText}
						<p class="lp-launch-end p-4 text-sm {endText === 'Cancelled' ? 'opacity-60' : 'text-error-500'}">
							{endText === "Cancelled" ? "Cancelled — no response" : endText}
						</p>
					{:else if details && !details.Response}
						<p class="p-4 text-sm opacity-60">Waiting for the response…</p>
					{:else if details?.Response}
						<CodeMirror
							value={details.Response.Raw}
							readonly
							class="text-xs"
							styles={{ "&": { fontSize: "0.6875rem" } }}
							lang={lang(details.Response.Raw)}
							{theme}
							extensions={responseExtensions}
						/>
					{:else if selectedId}
						<p class="p-4 text-sm opacity-60">Loading…</p>
					{:else}
						<p class="p-4 text-sm opacity-60">Launch the draft to see a response.</p>
					{/if}
				</div>
			</section>
		</div>
	</div>
{/if}
