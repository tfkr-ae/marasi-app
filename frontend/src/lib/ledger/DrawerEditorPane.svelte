<script>
	// Shared editor/loading/waiting pane body for Request, Response, Note, and
	// Metadata, used by both widescreen LedgerDrawer and narrow DrawerMobileStage.
	import { createEventDispatcher } from "svelte";
	import { javascript } from "@codemirror/lang-javascript";
	import DrawerEditor from "./DrawerEditor.svelte";
	import DrawerNote from "./DrawerNote.svelte";
	import { usesSyntax } from "./drawer.js";

	/** "request" | "response" | "note" | "metadata" */
	export let kind;
	export let details = undefined;
	export let bodies = { request: "", response: "" };
	export let syntaxMode = "auto";
	export let wrap = false;
	export let hasResponseBody = false;
	export let note = null;
	export let noteFor = null;
	export let noteVersion = 0;
	export let saveNote = null;
	export let metadata = null;

	const dispatch = createEventDispatcher();
	const jsonLanguage = javascript();
	const message = "p-3 text-2xs opacity-50";
</script>

{#if kind === "request"}
	{#if details === undefined}
		<p class={message}>Loading…</p>
	{:else if details === null}
		<p class={message}>Couldn't read this request.</p>
	{:else}
		<DrawerEditor
			value={bodies.request}
			lang={usesSyntax(bodies.request, syntaxMode) ? "http" : undefined}
			{wrap}
			on:suspend
		/>
	{/if}
{:else if kind === "response"}
	{#if details === undefined}
		<p class={message}>Loading…</p>
	{:else if hasResponseBody}
		<DrawerEditor
			value={bodies.response}
			lang={usesSyntax(bodies.response, syntaxMode) ? "http" : undefined}
			{wrap}
			on:suspend
		/>
	{:else if details !== null}
		<p class={message}>Waiting for the response…</p>
	{/if}
{:else if kind === "note"}
	{#if note === null}
		<p class={message}>Loading the note…</p>
	{:else}
		{#key `${noteFor}:${noteVersion}`}
			<DrawerNote
				id={noteFor}
				text={note}
				save={saveNote}
				on:edit={(e) => dispatch("noteedit", e.detail)}
				on:status={(e) => dispatch("notestatus", e.detail)}
			/>
		{/key}
	{/if}
{:else if kind === "metadata"}
	<div class="ledger-drawer-metadata h-full min-h-0 flex-1">
		{#if metadata === null}
			<p class={message}>Loading…</p>
		{:else}
			<DrawerEditor value={metadata} lang={jsonLanguage} wrap />
		{/if}
	</div>
{/if}
