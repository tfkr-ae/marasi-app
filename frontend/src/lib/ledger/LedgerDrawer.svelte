<script>
	// The Ledger drawer: the focused pair, request and response side by side
	// in CodeMirror, with the rail (or, expanded, the details column) on the
	// left. The note or the metadata opens in place of the response, beside
	// the request it is about. The pair is read in full through the Ledger
	// store; the page runs the actions the rail dispatches.
	import { createEventDispatcher } from "svelte";
	import { javascript } from "@codemirror/lang-javascript";
	import DrawerEditor from "./DrawerEditor.svelte";
	import DrawerNote from "./DrawerNote.svelte";
	import DrawerRail from "./DrawerRail.svelte";
	import { drawerBodies, metadataText, pairTiming, usesSyntax } from "./drawer.js";
	import { sameID } from "./pairs.js";
	import { lineWrap, marasiConfig, prettify } from "../../stores";
	import { groupBuilding, jobsStore } from "../../stores/jobsStore";

	/** The Ledger store: getDetails, getNote, getMetadata and saveNote. */
	export let store;
	/** The focused pair's table row. */
	export let pair;
	/** Its request number. */
	export let number;
	/** Its response, when it arrived after the pair was selected. */
	export let incomingResponse = null;
	export let maximised = false;
	/** Whether the details column shows instead of the rail. */
	export let expanded = false;
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
	const jsonLanguage = javascript();

	// Marasi is still moving older pairs' prettified copies out of metadata;
	// the rail's Prettify button shows it as an amber dot.
	$: prettifiedMoving = groupBuilding($jobsStore, "prettified");

	// The full pair (GetRawDetails): undefined while it loads, null when the
	// read failed. A newer pair's read wins.
	let details;
	let detailsFor = null;
	$: loadDetails(pair.ID);
	async function loadDetails(id) {
		if (sameID(detailsFor, id)) return;
		detailsFor = id;
		details = undefined;
		const row = await store.getDetails(id).catch((error) => {
			console.error("Reading the request failed:", error);
			return null;
		});
		if (sameID(detailsFor, id)) details = row ?? null;
	}

	// The pair's note, null while it loads. It is read again whenever the
	// row is (a bulk note change rereads it), except while the note is open
	// here: the editor holds it then.
	let note = null;
	let noteFor = null;
	$: reloadNote(pair);
	async function reloadNote(row) {
		const id = row.ID;
		if (pane === "note" && sameID(noteFor, id)) return;
		if (!sameID(noteFor, id)) note = null;
		noteFor = id;
		const text = await store.getNote(id).catch((error) => {
			console.error("Reading the note failed:", error);
			return "";
		});
		if (sameID(noteFor, id) && !(pane === "note" && note !== null)) note = text ?? "";
	}
	// The open note's save state: "saved", "unsaved", "saving" or "failed".
	// The rail's note button shows it; the note pane has no bar of its own.
	let noteStatus = "saved";
	$: if (pane !== "note") noteStatus = "saved";
	function onNoteEdit(event) {
		if (sameID(event.detail.id, noteFor)) note = event.detail.text;
	}

	// The metadata, read when its pane opens.
	let metadata = null;
	let metadataFor = null;
	$: if (pane === "metadata") loadMetadata(pair.ID);
	else metadataFor = null;
	async function loadMetadata(id) {
		if (sameID(metadataFor, id)) return;
		metadataFor = id;
		metadata = null;
		const value = await store.getMetadata(id).catch((error) => {
			console.error("Reading the metadata failed:", error);
			return {};
		});
		if (sameID(metadataFor, id)) metadata = metadataText(value);
	}

	$: bodies = drawerBodies(details, { prettify: $prettify, incomingResponse });
	$: syntaxMode = $marasiConfig.SyntaxMode;
	$: hasResponse = Boolean(bodies.response);
	// Wrap lines is on but a shown long string stopped an editor wrapping;
	// the rail's Wrap lines button shows it as an amber dot.
	let requestPaused = false;
	let responsePaused = false;
	$: wrapPaused = requestPaused || (pane === null && hasResponse && responsePaused);

	const message = "p-3 text-[11px] opacity-50";
	// The panes start a few pixels below the drawer's red top line, on the
	// editors' own background: WebKit snaps an editor's scrolling layer to
	// device pixels apart from the line, so text flush against it could paint
	// over it.
	const paneBox = "relative min-w-0 flex-1 pt-[3px] bg-white dark:bg-[#282c34]";
</script>

<div class="ledger-drawer flex h-full min-h-0 bg-surface-50 text-[11px] dark:bg-surface-900">
	{#if highlight}
		<div class="ledger-drawer-highlight w-[3px] flex-none" style="background: {highlight}" title="Highlighted"></div>
	{/if}
	<DrawerRail
		{pair}
		{number}
		{expanded}
		{maximised}
		{palette}
		{note}
		{noteStatus}
		indexing={prettifiedMoving}
		{wrapPaused}
		{findings}
		{testCases}
		{pane}
		{canOpenStream}
		timing={pairTiming(incomingResponse ? { ...pair, RespondedAt: incomingResponse.RespondedAt } : pair)}
		bind:prettify={$prettify}
		bind:wrap={$lineWrap}
		on:expand
		on:step
		on:maximise
		on:close
		on:action
		on:highlight
		on:pane={(e) => (pane = e.detail)}
	/>
	<div class="flex min-w-0 flex-1 flex-col">
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
						{#key noteFor}
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
					{:else if hasResponse}
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
</div>
