<script>
	// The Ledger drawer: the focused pair, request and response side by side
	// in CodeMirror, with the top command strip, the left inspect/view rail
	// (or expanded details column), and the right workflow/actions rail (or
	// expanded actions column). On narrow screens (<= 40rem), the rails become
	// mutually exclusive slide-over sidebars paired with a unified 4-pane GPU
	// swipe stage (DrawerMobileStage). The pair is read in full through the
	// Ledger store; the page runs the actions the drawer dispatches.
	import { createEventDispatcher, onDestroy } from "svelte";
	import { getToastStore } from "@skeletonlabs/skeleton";
	import { javascript } from "@codemirror/lang-javascript";
	import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-svelte";
	import DrawerCommandStrip from "./DrawerCommandStrip.svelte";
	import DrawerEditor from "./DrawerEditor.svelte";
	import DrawerLeftRail from "./DrawerLeftRail.svelte";
	import DrawerMobileStage from "./DrawerMobileStage.svelte";
	import DrawerNote from "./DrawerNote.svelte";
	import DrawerPaneBar from "./DrawerPaneBar.svelte";
	import DrawerRightRail from "./DrawerRightRail.svelte";
	import { drawerBodies, metadataText, pairTiming, usesSyntax } from "./drawer.js";
	import { pairHasResponse } from "./drawerPresentation.js";
	import { sameID } from "./pairs.js";
	import { compactWidth } from "../platform.js";
	import { toastError } from "../toasts.js";
	import { lineWrap, marasiConfig, prettify } from "../../stores";
	import { groupBuilding, jobsStore } from "../../stores/jobsStore";
	import { joinedResponseStore } from "../../stores/joinedResponseStore.js";
	import { RAW_ONLY } from "../../stores/trafficApi.js";

	/** The Ledger store: getDetails, noteFullRead, getNote, getMetadata and saveNote. */
	export let store;
	/** The focused pair's table row. */
	export let pair;
	/** Its request number. */
	export let number;
	/** Its response, when it arrived after the pair was selected. */
	export let incomingResponse = null;
	export let maximised = false;
	/** Whether the left details column shows instead of the left rail. */
	export let leftExpanded = false;
	/** Whether the right actions column shows instead of the right rail. */
	export let rightExpanded = false;
	/** "note" or "metadata" while one shows in place of the response; null for the response. */
	export let pane = null;
	/** The highlight colour, or null, and the palette. */
	export let highlight = null;
	export let palette = [];
	/** The findings and test cases that list the pair. */
	export let findings = [];
	export let testCases = [];
	/** Whether the pair is a WebSocket upgrade whose stream can open. */
	export let canOpenStream = false;

	const dispatch = createEventDispatcher();
	const toastStore = getToastStore();
	const jsonLanguage = javascript();

	$: isNarrow = $compactWidth;

	// Local mirrors for narrow sidebars updated synchronously on gesture end
	// and corner toggle clicks so there is never a 1-frame snap-back waiting
	// for the store round-trip. Narrow mode enforces mutual exclusion.
	let uiLeft = leftExpanded;
	let uiRight = rightExpanded;
	$: {
		uiLeft = leftExpanded;
		uiRight = isNarrow && leftExpanded ? false : rightExpanded;
	}

	function commitNarrowSidebars(nextLeft, nextRight) {
		const left = Boolean(nextLeft);
		const right = left ? false : Boolean(nextRight);
		uiLeft = left;
		uiRight = right;
		if (left !== leftExpanded) dispatch("expandLeft", left);
		if (right !== rightExpanded) dispatch("expandRight", right);
	}

	function toggleLeftCorner() {
		if (isNarrow) commitNarrowSidebars(!uiLeft, false);
		else dispatch("expandLeft", !leftExpanded);
	}

	function toggleRightCorner() {
		if (isNarrow) commitNarrowSidebars(false, !uiRight);
		else dispatch("expandRight", !rightExpanded);
	}

	// Marasi is still moving older pairs' prettified copies out of metadata;
	// the rail's Prettify button shows it as an amber dot.
	$: prettifiedMoving = groupBuilding($jobsStore, "prettified");

	// The pair (GetRawDetails): undefined while it loads, null when the read
	// failed. A newer pair's read wins. With Prettify off only the raw text
	// is read; turning Prettify on reads the pair again in full, since a
	// part without a prettified copy (a request with no body) shows raw.
	let details;
	let detailsFor = null;
	let detailsFull = false;
	$: loadDetails(pair.ID, $prettify);
	async function loadDetails(id, full) {
		const moved = !sameID(detailsFor, id);
		if (!moved && (detailsFull || !full)) return;
		detailsFor = id;
		detailsFull = full;
		if (moved) details = undefined;
		const row = await store.getDetails(id, full ? undefined : RAW_ONLY).catch((error) => {
			console.error("Reading the request failed:", error);
			return null;
		});
		if (row) store.noteFullRead?.(id, row);
		if (sameID(detailsFor, id) && detailsFull === full) details = row ?? null;
	}

	// The pair's note, null while it loads. It is read again whenever the
	// row is (a bulk note change or another client's note event makes a new
	// row). While the note is open here, the editor holds it: another
	// client's text replaces it only when nothing typed is waiting to save,
	// and `noteVersion` then starts the editor again from it.
	let note = null;
	let noteFor = null;
	let noteVersion = 0;
	// The open note's save state: "saved", "unsaved", "saving" or "failed".
	// The rail's note button and narrow Note tab show it.
	let noteStatus = "saved";
	$: reloadNote(pair);
	async function reloadNote(row) {
		const id = row.ID;
		const editing = () => (isNarrow || pane === "note") && sameID(noteFor, id) && note !== null;
		if (editing() && noteStatus !== "saved") return;
		if (!sameID(noteFor, id)) {
			note = null;
			noteStatus = "saved";
		}
		noteFor = id;
		const text = (await store.getNote(id).catch((error) => {
			console.error("Reading the note failed:", error);
			return "";
		})) ?? "";
		if (!sameID(noteFor, id)) return;
		if (!editing()) note = text;
		else if (noteStatus === "saved" && text !== note) {
			note = text;
			noteVersion += 1;
		}
	}
	$: if (!isNarrow && pane !== "note") noteStatus = "saved";
	function onNoteEdit(event) {
		if (sameID(event.detail.id, noteFor)) note = event.detail.text;
	}

	// The metadata, read when its pane opens (or on narrow mobile where Meta
	// sits in the 4-pane swipe track) and again whenever the row changes.
	let metadata = null;
	let metadataFor = null;
	$: if (pane === "metadata" || isNarrow) loadMetadata(pair);
	else metadataFor = null;
	async function loadMetadata(row) {
		if (metadataFor === row) return;
		if (!sameID(metadataFor?.ID, row.ID)) metadata = null;
		metadataFor = row;
		const value = await store.getMetadata(row.ID).catch((error) => {
			console.error("Reading the metadata failed:", error);
			return {};
		});
		if (metadataFor === row) metadata = metadataText(value);
	}

	const joined = joinedResponseStore.createPreview();
	onDestroy(() => joined.destroy());

	$: pairDetails = sameID(details?.Request?.ID, pair?.ID) ? details : null;
	$: pairIncoming = sameID(incomingResponse?.ID, pair?.ID) ? incomingResponse : null;
	$: joined.sync({
		id: pair?.ID,
		active: (isNarrow || pane === null) && pair?.ID != null,
		hasResponse: Boolean(pairIncoming?.Raw || pairDetails?.Response?.Raw || Number(pair?.StatusCode) > 0),
		sources: [pair?.Streamed, pairIncoming?.Streamed, pairDetails?.Streamed, pairDetails?.Metadata?.streamed],
	});

	$: bodies = drawerBodies(details, { prettify: $prettify, incomingResponse, joinedResponse: $joined });
	$: syntaxMode = $marasiConfig.SyntaxMode;
	$: hasResponseBody = Boolean(bodies.response);
	$: hasResponse = pairHasResponse(pair, { incomingResponse: pairIncoming, responseBody: bodies.response });
	$: hasNote = note != null ? note.length > 0 : pair.Metadata?.has_note == 1;
	$: timing = pairTiming(pairIncoming ? { ...pair, RespondedAt: pairIncoming.RespondedAt } : pair);
	// Wrap lines is on but a shown long string stopped an editor wrapping;
	// the rail's Wrap lines button shows it as an amber dot.
	let requestPaused = false;
	let responsePaused = false;
	$: wrapPaused = requestPaused || ((isNarrow || pane === null) && hasResponseBody && responsePaused);

	function copyMetadata() {
		if (metadata == null) return;
		navigator.clipboard
			.writeText(metadata)
			.then(() => toastStore.trigger({ message: "Metadata copied to clipboard", background: "variant-filled-success" }))
			.catch(() => toastError(toastStore, "Failed to copy metadata"));
	}

	$: leftCornerOpen = isNarrow ? uiLeft : leftExpanded;
	$: rightCornerOpen = isNarrow ? uiRight : rightExpanded;

	const message = "p-3 text-2xs opacity-50";
	const paneBox = "relative min-h-0 min-w-0 flex-1 bg-white dark:bg-[#282c34]";
	const cornerBtn = "flex h-6 w-6 flex-none items-center justify-center hover:bg-surface-200-700-token";
</script>

<div class="ledger-drawer flex h-full min-h-0 flex-col bg-surface-50 text-2xs dark:bg-surface-900">
	{#if highlight}
		<div class="ledger-drawer-highlight h-[2px] w-full flex-none" style="background: {highlight}" title="Highlighted"></div>
	{/if}
	<DrawerCommandStrip
		{pair}
		{number}
		incomingResponse={pairIncoming}
		responseBody={bodies.response}
		{maximised}
		{highlight}
		{palette}
		{canOpenStream}
		compact={isNarrow}
		on:step
		on:maximise
		on:close
		on:action
		on:highlight
	>
		<button
			slot="left-corner"
			type="button"
			class="ledger-drawer-expand ledger-drawer-expand-left {cornerBtn} {leftCornerOpen
				? 'bg-surface-200-700-token text-primary-500'
				: ''}"
			title={leftCornerOpen ? "Collapse the details" : "Show the details"}
			aria-label={leftCornerOpen ? "Collapse the details" : "Show the details"}
			aria-expanded={leftCornerOpen}
			on:click={toggleLeftCorner}
		>
			{#if leftCornerOpen}<PanelLeftClose size={14} />{:else}<PanelLeftOpen size={14} />{/if}
		</button>
		<button
			slot="right-corner"
			type="button"
			class="ledger-drawer-expand-right {cornerBtn} {rightCornerOpen
				? 'bg-surface-200-700-token text-primary-500'
				: ''}"
			title={rightCornerOpen ? "Collapse the actions" : "Show the actions"}
			aria-label={rightCornerOpen ? "Collapse the actions" : "Show the actions"}
			aria-expanded={rightCornerOpen}
			on:click={toggleRightCorner}
		>
			{#if rightCornerOpen}<PanelRightClose size={14} />{:else}<PanelRightOpen size={14} />{/if}
		</button>
	</DrawerCommandStrip>
	{#if isNarrow}
		<DrawerMobileStage
			{store}
			{pair}
			{details}
			{bodies}
			{note}
			{noteFor}
			{noteVersion}
			{noteStatus}
			{metadata}
			{syntaxMode}
			{palette}
			{findings}
			{testCases}
			{timing}
			{hasResponse}
			{hasResponseBody}
			{hasNote}
			{canOpenStream}
			indexing={prettifiedMoving}
			{wrapPaused}
			{pane}
			leftOpen={uiLeft}
			rightOpen={uiRight}
			bind:prettify={$prettify}
			bind:wrap={$lineWrap}
			on:sidebars={(e) => commitNarrowSidebars(e.detail.leftOpen, e.detail.rightOpen)}
			on:pane={(e) => (pane = e.detail)}
			on:action
			on:highlight
			on:noteedit={onNoteEdit}
			on:notestatus={(e) => (noteStatus = e.detail)}
			on:requestsuspend={(e) => (requestPaused = e.detail)}
			on:responsesuspend={(e) => (responsePaused = e.detail)}
		/>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DrawerLeftRail
				{pair}
				expanded={leftExpanded}
				{palette}
				{note}
				{noteStatus}
				indexing={prettifiedMoving}
				{wrapPaused}
				{findings}
				{testCases}
				{pane}
				{timing}
				bind:prettify={$prettify}
				bind:wrap={$lineWrap}
				on:highlight
				on:pane={(e) => (pane = e.detail)}
			/>
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				<DrawerPaneBar
					{pane}
					requestBody={bodies.request}
					responseBody={bodies.response}
					metadataBody={metadata}
					{hasResponse}
					{hasNote}
					{noteStatus}
					on:pane={(e) => (pane = e.detail)}
					on:action
					on:copymetadata={copyMetadata}
				/>
				<div class="flex min-h-0 flex-1">
					<div class="ledger-drawer-request {paneBox}">
						{#if details === undefined}
							<p class={message}>Loading…</p>
						{:else if details === null}
							<p class={message}>Couldn't read this request.</p>
						{:else}
							<DrawerEditor
								value={bodies.request}
								lang={usesSyntax(bodies.request, syntaxMode) ? "http" : undefined}
								wrap={$lineWrap}
								on:suspend={(e) => (requestPaused = e.detail)}
							/>
						{/if}
					</div>
					<div class="ledger-drawer-response {paneBox} flex flex-col border-l border-surface-300-600-token">
						{#if pane === "note"}
							{#if note === null}
								<p class={message}>Loading the note…</p>
							{:else}
								{#key `${noteFor}:${noteVersion}`}
									<DrawerNote
										id={noteFor}
										text={note}
										save={store.saveNote}
										on:edit={onNoteEdit}
										on:status={(e) => (noteStatus = e.detail)}
									/>
								{/key}
							{/if}
						{:else if pane === "metadata"}
							<div class="ledger-drawer-metadata min-h-0 flex-1">
								{#if metadata === null}
									<p class={message}>Loading…</p>
								{:else}
									<DrawerEditor value={metadata} lang={jsonLanguage} wrap />
								{/if}
							</div>
						{:else}
							{#if details === undefined}
								<p class={message}>Loading…</p>
							{:else if hasResponseBody}
								<DrawerEditor
									value={bodies.response}
									lang={usesSyntax(bodies.response, syntaxMode) ? "http" : undefined}
									wrap={$lineWrap}
									on:suspend={(e) => (responsePaused = e.detail)}
								/>
							{:else if details !== null}
								<p class={message}>Waiting for the response…</p>
							{/if}
						{/if}
					</div>
				</div>
			</div>
			<DrawerRightRail expanded={rightExpanded} {canOpenStream} {hasResponse} on:action />
		</div>
	{/if}
</div>
