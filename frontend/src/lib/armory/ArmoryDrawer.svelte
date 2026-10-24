<script>
	// The Armory drawer: the open pair's request and response side by side in
	// the Ledger's 11px editors, with the rail (or, expanded, the details
	// column) on the left. It fills the box the page gives it, inside the
	// workspace right of the dock. The `details` slot passes through to the
	// expanded column.
	import DrawerEditor from "../ledger/DrawerEditor.svelte";
	import { drawerBodies, pairTiming, usesSyntax } from "../ledger/drawer.js";
	import { sameID } from "../ledger/pairs.js";
	import { pairURL } from "../ledger/rowMenu.js";
	import { lineWrap, marasiConfig, prettify } from "../../stores";
	import { GetRawDetails } from "../wailsjs/go/main/App";
	import ArmoryDrawerRail from "./ArmoryDrawerRail.svelte";

	/** The open pair's traffic row, and its request number. */
	export let pair;
	export let number;
	export let maximised = false;
	/** Whether the details column shows instead of the rail. */
	export let expanded = false;
	export let onClose = () => {};
	export let onStep = (delta) => {};
	export let onMaximise = () => {};
	/** Writes `text` to the clipboard; `what` says which copy it is. */
	export let onCopy = (text, what) => {};
	/** The Actions click; its currentTarget anchors the row menu. */
	export let onActions = (event) => {};

	$: hasResponse = Number(pair.StatusCode) > 0;

	// The full pair (GetRawDetails): undefined while it loads, null when the
	// read failed. It is read again when the response arrives; a newer
	// pair's read wins.
	let details;
	let detailsFor = null;
	let detailsAnswered = false;
	let read = 0;
	let reading = Promise.resolve(null);
	$: loadDetails(pair.ID, hasResponse);
	function loadDetails(id, answered) {
		const moved = !sameID(detailsFor, id);
		if (!moved && detailsAnswered === answered) return;
		detailsFor = id;
		detailsAnswered = answered;
		if (moved) details = undefined;
		const current = ++read;
		reading = GetRawDetails(id)
			.catch((error) => {
				console.error("Reading the request failed:", error);
				return null;
			})
			.then((row) => {
				if (current === read) details = row ?? null;
				return row ?? null;
			});
	}

	async function copy(what) {
		if (what === "url") return onCopy(pairURL(pair), what);
		const row = details ?? (await reading);
		onCopy((what === "request" ? row?.Request?.Raw : row?.Response?.Raw) ?? "", what);
	}

	$: bodies = drawerBodies(details, { prettify: $prettify });
	$: syntaxMode = $marasiConfig.SyntaxMode;

	const message = "p-3 text-[11px] opacity-50";
	// As in the Ledger drawer, the panes start a few pixels below the red top
	// line, on the editors' own background.
	const paneBox = "relative min-w-0 flex-1 pt-[3px] bg-white dark:bg-[#282c34]";
</script>

<div class="armory-drawer flex h-full min-h-0 bg-surface-50 text-[11px] dark:bg-surface-900">
	<ArmoryDrawerRail
		{pair}
		{number}
		{expanded}
		{maximised}
		timing={pairTiming(pair)}
		onExpand={(value) => (expanded = value)}
		{onClose}
		{onMaximise}
		{onStep}
		onCopy={copy}
		{onActions}
	>
		<svelte:fragment slot="details"><slot name="details" /></svelte:fragment>
	</ArmoryDrawerRail>
	<div class="flex min-h-0 min-w-0 flex-1">
		<div class="armory-drawer-request {paneBox}">
			{#if details === undefined}
				<p class={message}>Loading…</p>
			{:else if details === null}
				<p class={message}>Couldn't read this request.</p>
			{:else}
				<DrawerEditor
					value={bodies.request}
					lang={usesSyntax(bodies.request, syntaxMode) ? "http" : undefined}
					wrap={$lineWrap}
				/>
			{/if}
		</div>
		<div class="armory-drawer-response {paneBox} flex flex-col border-l border-surface-300-600-token">
			{#if details === undefined}
				<p class={message}>Loading…</p>
			{:else if bodies.response}
				<DrawerEditor
					value={bodies.response}
					lang={usesSyntax(bodies.response, syntaxMode) ? "http" : undefined}
					wrap={$lineWrap}
				/>
			{:else if details !== null}
				<p class={message}>Waiting for the response…</p>
			{/if}
		</div>
	</div>
</div>
