<script>
	// The Armory drawer: the open pair's request and response side by side in
	// the Ledger's 11px editors (request over response when the panes are
	// narrow), with the rail (or, expanded, the details
	// column) on the left. It fills the box the page gives it, inside the
	// workspace right of the dock. The `details` slot passes through to the
	// expanded column.
	import { onDestroy } from "svelte";
	import PaneTabs from "../components/PaneTabs.svelte";
	import DrawerEditor from "../ledger/DrawerEditor.svelte";
	import { drawerBodies, pairTiming } from "../ledger/drawer.js";
	import { RAW_ONLY } from "../../stores/trafficApi.js";
	import { sameID } from "../ledger/pairs.js";
	import { pairURL } from "../ledger/rowMenu.js";
	import { lineWrap, marasiConfig, prettify } from "../../stores";
	import { ledgerStore } from "../../stores/ledgerStore";
	import { joinedResponseStore } from "../../stores/joinedResponseStore.js";
	import ArmoryDrawerRail from "./ArmoryDrawerRail.svelte";
	import ResponseModeToggle from "../render/ResponseModeToggle.svelte";
	import ResponseRenderPane from "../render/ResponseRenderPane.svelte";

	/** The open pair's traffic row, and its request number. */
	export let pair;
	export let number;
	export let maximised = false;
	/** Whether the details column shows instead of the rail. */
	export let expanded = false;
	/** "raw" | "render" for the response pane; sticky across pairs in a run. */
	export let responseMode = "raw";
	export let onClose = () => {};
	/** Whether Previous and Next request have a pair to open. */
	export let canPrevious = true;
	export let canNext = true;
	export let onStep = (delta) => {};
	export let onMaximise = () => {};
	/** Writes `text` to the clipboard; `what` says which copy it is. */
	export let onCopy = (text, what) => {};
	/** The Actions click; its currentTarget anchors the row menu. */
	export let onActions = (event) => {};

	$: hasResponse = Number(pair.StatusCode) > 0;

	// The full pair (ledgerStore.getDetails): undefined while it loads, null
	// when the read failed. It is read again when the response arrives; a
	// newer pair's read wins.
	// With Prettify off only the raw text is read; turning it on reads the
	// pair again in full.
	let details;
	let detailsFor = null;
	let detailsAnswered = false;
	let detailsFull = false;
	let read = 0;
	let reading = Promise.resolve(null);
	$: loadDetails(pair.ID, hasResponse, $prettify);
	function loadDetails(id, answered, full) {
		const moved = !sameID(detailsFor, id);
		if (!moved && detailsAnswered === answered && (detailsFull || !full)) return;
		detailsFor = id;
		detailsAnswered = answered;
		detailsFull = full;
		if (moved) details = undefined;
		const current = ++read;
		reading = ledgerStore
			.getDetails(id, full ? undefined : RAW_ONLY)
			.catch((error) => {
				console.error("Reading the request failed:", error);
				return null;
			})
			.then((row) => {
				if (current === read) details = row ?? null;
				return row ?? null;
			});
	}

	const joined = joinedResponseStore.createPreview();
	onDestroy(() => joined.destroy());
	$: pairDetails = sameID(details?.Request?.ID, pair?.ID) ? details : null;
	$: joined.sync({
		id: pair?.ID,
		active: pair?.ID != null,
		hasResponse: Boolean(hasResponse || pairDetails?.Response?.Raw),
		sources: [pair?.Streamed, pairDetails?.Streamed, pairDetails?.Metadata?.streamed],
	});

	async function copy(what) {
		if (what === "url") return onCopy(pairURL(pair), what);
		const row = details ?? (await reading);
		onCopy((what === "request" ? row?.Request?.Raw : ($joined ?? row?.Response?.Raw)) ?? "", what);
	}

	$: bodies = drawerBodies(details, { prettify: $prettify, joinedResponse: $joined });
	$: syntaxMode = $marasiConfig.SyntaxMode;
	$: canRenderResponse = hasResponse || Boolean(bodies.response);

	/** Toggles the response pane between Raw HTTP and Rendered preview. */
	export function toggleRender() {
		if (!canRenderResponse) return;
		responseMode = responseMode === "render" ? "raw" : "render";
	}

	const message = "p-3 text-2xs opacity-50";
	const paneBox = "relative min-h-0 min-w-0 flex-1 flex flex-col bg-white dark:bg-[#282c34]";
	const paneBar =
		"flex h-6 flex-none items-center justify-between gap-2 border-b border-surface-300-600-token bg-surface-50 px-2.5 dark:bg-surface-900";

	// Below this width the panes stack, so each editor keeps the full width.
	const STACK_BELOW = 480;
	let panesWidth = Infinity;
	$: stacked = panesWidth < STACK_BELOW;
	// The pane on show when the screen is too narrow for both (PaneTabs).
	let narrowPane = "request";
</script>

<div class="armory-drawer flex h-full min-h-0 bg-surface-50 text-2xs dark:bg-surface-900">
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
		{canPrevious}
		{canNext}
		onCopy={copy}
		{onActions}
	>
		<svelte:fragment slot="details"><slot name="details" /></svelte:fragment>
	</ArmoryDrawerRail>
	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	<PaneTabs
		tabs={[
			{ id: "request", label: "Request" },
			{ id: "response", label: "Response" },
		]}
		bind:active={narrowPane}
	/>
	<div
		class="armory-drawer-panes flex min-h-0 min-w-0 flex-1 {stacked ? 'flex-col' : ''}"
		data-stacked={stacked}
		bind:clientWidth={panesWidth}
	>
		<div class="armory-drawer-request {paneBox}" class:pane-off={narrowPane !== "request"}>
			<div class={paneBar}>
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="h-1.5 w-1.5 flex-none rounded-full bg-primary-500" aria-hidden="true"></span>
					<span class="text-3xs font-semibold uppercase tracking-wider opacity-80">Request</span>
				</div>
			</div>
			<div class="relative min-h-0 flex-1 pt-[3px]">
				{#if details === undefined}
					<p class={message}>Loading…</p>
				{:else if details === null}
					<p class={message}>Couldn't read this request.</p>
				{:else}
					<DrawerEditor
						value={bodies.request}
						lang="http"
						{syntaxMode}
						wrap={$lineWrap}
					/>
				{/if}
			</div>
		</div>
		<div
			class="armory-drawer-response {paneBox} border-surface-300-600-token {stacked
				? 'border-t'
				: 'border-l'}"
			class:pane-off={narrowPane !== "response"}
		>
			<div class={paneBar}>
				<span class="text-3xs font-semibold uppercase tracking-wider opacity-80">Response</span>
				{#if canRenderResponse}
					<ResponseModeToggle bind:mode={responseMode} actionId="armory.drawer.toggle-render" />
				{/if}
			</div>
			<div class="relative flex min-h-0 flex-1 flex-col {responseMode === 'render' ? '' : 'pt-[3px]'}">
				{#if details === undefined}
					<p class={message}>Loading…</p>
				{:else if responseMode === "render" && canRenderResponse}
					<ResponseRenderPane
						rawBytes={$joined != null ? null : (pairDetails?.Response?.RawBytes ?? null)}
						rawText={bodies.response}
						contentType={pairDetails?.Response?.ContentType ?? pair?.ContentType ?? ""}
						statusCode={pairDetails?.Response?.StatusCode ?? pair?.StatusCode ?? 0}
						truncated={Boolean(pairDetails?.Metadata?.body_cut_short || pairDetails?.Metadata?.body_too_large)}
						onShowRaw={() => (responseMode = "raw")}
					/>
				{:else if bodies.response}
					<DrawerEditor
						value={bodies.response}
						lang="http"
						{syntaxMode}
						wrap={$lineWrap}
					/>
				{:else if details !== null}
					<p class={message}>Waiting for the response…</p>
				{/if}
			</div>
		</div>
	</div>
</div>
</div>

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	@media (max-width: 40rem) {
		:global(html.mobile .armory-drawer-panes) {
			flex-direction: row !important;
		}
	}
</style>
