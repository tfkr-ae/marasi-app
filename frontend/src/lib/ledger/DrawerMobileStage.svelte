<script>
	// Narrow-mobile (<= 40rem) body of the Ledger drawer: a clean 100%-width
	// Request | Response | Note | Meta tab bar above one unified 120fps
	// GPU-composited (translate3d) horizontal gesture stage driving both the
	// 4-pane carousel and the mutually exclusive left Details and right Actions
	// slide-over sidebars. Vertical scrolling inside CodeMirror editors and
	// inside open sidebars stays native (touch-action: pan-y + axis lock).
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import DrawerActionsContent from "./DrawerActionsContent.svelte";
	import DrawerDetailsContent from "./DrawerDetailsContent.svelte";
	import DrawerEditorPane from "./DrawerEditorPane.svelte";
	import ResponseModeToggle from "../render/ResponseModeToggle.svelte";
	import { noteIndicator } from "./drawerPresentation.js";
	import {
		SWIPE_PANES,
		SWIPE_PANEL_WIDTH,
		SWIPE_PANE_LABELS,
		applyExternalPane,
		beginGesture,
		cancelGesture,
		computeLivePatch,
		computeTransforms,
		createSwipeState,
		endGesture,
		moveGesture,
		selectPane,
		setSidebars,
	} from "./drawerSwipe.js";

	export let store;
	export let pair;
	export let details = undefined;
	export let bodies = { request: "", response: "" };
	export let note = null;
	export let noteFor = null;
	export let noteVersion = 0;
	export let noteStatus = "saved";
	export let metadata = null;
	export let syntaxMode = undefined;
	export let palette = [];
	export let findings = [];
	export let testCases = [];
	export let timing = "";
	export let hasResponse = false;
	export let hasResponseBody = false;
	export let responseMode = "raw";
	export let rawResponseBytes = null;
	export let responseContentType = "";
	export let responseStatusCode = 0;
	export let responseTruncated = false;
	export let canBrowserView = false;
	export let onBrowserView = null;
	export let hasNote = false;
	export let canOpenStream = false;
	export let indexing = false;
	export let wrapPaused = false;
	export let prettify = true;
	export let wrap = false;
	/** "note" or "metadata" when that pane is active; null for Request or Response. */
	export let pane = null;
	/** Mutually exclusive slide-over sidebar states, mirrored synchronously by LedgerDrawer. */
	export let leftOpen = false;
	export let rightOpen = false;

	const dispatch = createEventDispatcher();
	const EASE = "250ms cubic-bezier(0.22, 1, 0.36, 1)";

	const initialIdx = pane === "note" ? 2 : pane === "metadata" ? 3 : 0;
	// Non-reactive container so active touch gestures never trigger Svelte
	// component invalidation per frame; reactive UI state below updates only
	// when a gesture settles or a tab/corner/external prop changes.
	const live = {
		state: createSwipeState({ paneIndex: initialIdx, leftOpen, rightOpen }),
		stageWidth: 390,
		panelWidth: SWIPE_PANEL_WIDTH,
	};
	let activeIdx = live.state.paneIndex;
	let uiLeft = live.state.leftOpen;
	let uiRight = live.state.rightOpen;
	let lastExternalPane = pane;
	let lastExternalLeft = leftOpen;
	let lastExternalRight = rightOpen;
	let mounted = false;

	let stageEl;
	let trackEl;
	let leftEl;
	let rightEl;
	let scrimEl;
	let rafId = 0;
	let resizeObserver = null;

	function measureStage() {
		const width = stageEl?.clientWidth || 390;
		live.stageWidth = width;
		live.panelWidth =
			leftEl?.offsetWidth || rightEl?.offsetWidth || Math.min(SWIPE_PANEL_WIDTH, Math.round(width * 0.84));
	}

	function syncUi() {
		const s = live.state;
		if (activeIdx !== s.paneIndex) activeIdx = s.paneIndex;
		if (uiLeft !== s.leftOpen) uiLeft = s.leftOpen;
		if (uiRight !== s.rightOpen) uiRight = s.rightOpen;
	}

	// Mutate DOM styles through parameter helpers so Svelte 4 never wraps
	// `trackEl.style.* = ...` (on `bind:this` vars) in `$$invalidate(...)`.
	function setTransform(el, transition, x) {
		if (!el) return;
		el.style.transition = transition;
		el.style.transform = `translate3d(${x}px, 0, 0)`;
	}

	function setOpacity(el, transition, opacity) {
		if (!el) return;
		el.style.transition = transition;
		el.style.opacity = String(opacity);
	}

	function applyResting(immediate) {
		const s = live.state;
		const resting = computeTransforms(
			s.gesture ? { ...s, gesture: null } : s,
			{ stageWidth: live.stageWidth, panelWidth: live.panelWidth },
		);
		const t = immediate ? "none" : `transform ${EASE}`;
		const o = immediate ? "none" : `opacity ${EASE}`;
		setTransform(trackEl, t, resting.trackX);
		setTransform(leftEl, t, resting.leftX);
		setTransform(rightEl, t, resting.rightX);
		setOpacity(scrimEl, o, resting.scrimOpacity);
	}

	function syncPaneFromIndex(idx) {
		const id = SWIPE_PANES[idx];
		const nextPane = id === "note" ? "note" : id === "metadata" ? "metadata" : null;
		lastExternalPane = nextPane;
		if (nextPane !== pane) dispatch("pane", nextPane);
	}

	function commitSidebars(nextLeft, nextRight) {
		cancelActiveRaf();
		live.state = setSidebars(live.state, { leftOpen: nextLeft, rightOpen: nextRight });
		syncUi();
		applyResting(false);
		if (live.state.leftOpen !== leftOpen || live.state.rightOpen !== rightOpen) {
			dispatch("sidebars", { leftOpen: live.state.leftOpen, rightOpen: live.state.rightOpen });
		}
	}

	function onTabPick(indexOrId) {
		cancelActiveRaf();
		const next = selectPane(live.state, indexOrId);
		const sidebarsChanged = next.leftOpen !== leftOpen || next.rightOpen !== rightOpen;
		live.state = next;
		syncUi();
		syncPaneFromIndex(next.paneIndex);
		applyResting(false);
		if (sidebarsChanged) {
			dispatch("sidebars", { leftOpen: next.leftOpen, rightOpen: next.rightOpen });
		}
	}

	// Sync sidebar props only when the parent prop actually changed, preventing
	// stale props from snapping back a synchronously settled sidebar gesture.
	function syncExternalSidebars(nextLeft, nextRight) {
		lastExternalLeft = nextLeft;
		lastExternalRight = nextRight;
		if (live.state.gesture) return;
		const normalized = setSidebars(live.state, { leftOpen: nextLeft, rightOpen: nextRight });
		if (normalized.leftOpen === live.state.leftOpen && normalized.rightOpen === live.state.rightOpen) return;
		live.state = normalized;
		syncUi();
		if (mounted) applyResting(false);
	}
	$: if (leftOpen !== lastExternalLeft || rightOpen !== lastExternalRight) {
		syncExternalSidebars(leftOpen, rightOpen);
	}

	// Sync pane prop changed externally (shortcuts ⌘⇧N / ⌘⇧M, row menu actions)
	// and dismiss any open sidebar so the target editor is immediately visible.
	function syncExternalPane(nextPane) {
		lastExternalPane = nextPane;
		const res = applyExternalPane(live.state, nextPane);
		if (!res.changed) return;
		cancelActiveRaf();
		live.state = res.state;
		syncUi();
		if (mounted) applyResting(false);
		if (res.sidebarClosed || leftOpen || rightOpen) {
			dispatch("sidebars", { leftOpen: false, rightOpen: false });
		}
	}
	$: if (pane !== lastExternalPane) syncExternalPane(pane);

	function renderLiveFrame() {
		rafId = 0;
		const patch = computeLivePatch(live.state, { stageWidth: live.stageWidth, panelWidth: live.panelWidth });
		if (!patch) return;
		if (patch.trackX !== undefined) setTransform(trackEl, "none", patch.trackX);
		if (patch.leftX !== undefined) setTransform(leftEl, "none", patch.leftX);
		if (patch.rightX !== undefined) setTransform(rightEl, "none", patch.rightX);
		if (patch.scrimOpacity !== undefined) setOpacity(scrimEl, "none", patch.scrimOpacity);
	}

	function cancelActiveRaf() {
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	onMount(() => {
		mounted = true;
		measureStage();
		applyResting(true);
		if (typeof ResizeObserver !== "undefined" && stageEl) {
			resizeObserver = new ResizeObserver(() => {
				measureStage();
				if (!live.state.gesture) applyResting(true);
			});
			resizeObserver.observe(stageEl);
		}
	});

	onDestroy(() => {
		cancelActiveRaf();
		resizeObserver?.disconnect();
	});

	function onStageTouchStart(event) {
		if (!stageEl) return;
		if (event.touches.length !== 1) {
			if (live.state.gesture) {
				cancelActiveRaf();
				live.state = cancelGesture(live.state);
				applyResting(false);
			}
			return;
		}
		cancelActiveRaf();
		measureStage();
		const rect = stageEl.getBoundingClientRect();
		const touch = event.touches[0];
		live.state = beginGesture(live.state, {
			x: touch.clientX,
			y: touch.clientY,
			time: performance.now(),
			stageLeft: rect.left,
			stageWidth: rect.width,
		});
	}

	function onStageTouchMove(event) {
		if (event.touches.length !== 1) return;
		const touch = event.touches[0];
		const step = moveGesture(live.state, {
			x: touch.clientX,
			y: touch.clientY,
			time: performance.now(),
		});
		live.state = step.state;
		if (step.preventDefault) event.preventDefault();
		if (step.active && !rafId) {
			rafId = requestAnimationFrame(renderLiveFrame);
		}
	}

	function onStageTouchEnd() {
		cancelActiveRaf();
		const prevPaneIndex = live.state.paneIndex;
		const { state: next, mode } = endGesture(live.state);
		live.state = next;
		if (!mode) return;

		syncUi();
		if (next.paneIndex !== prevPaneIndex) {
			syncPaneFromIndex(next.paneIndex);
		}
		if (next.leftOpen !== leftOpen || next.rightOpen !== rightOpen) {
			dispatch("sidebars", { leftOpen: next.leftOpen, rightOpen: next.rightOpen });
		}
		applyResting(false);
	}

	function onStageTouchCancel() {
		cancelActiveRaf();
		if (!live.state.gesture) return;
		live.state = cancelGesture(live.state);
		applyResting(false);
	}

	function runAction(actionId) {
		commitSidebars(false, false);
		dispatch("action", actionId);
	}

	$: noteInfo = noteIndicator(noteStatus, hasNote);

	const slidePane = "relative flex h-full min-h-0 w-full flex-none flex-col overflow-hidden bg-white dark:bg-[#282c34]";
</script>

<!-- Full-width narrow pane bar: Request | Response | Note | Meta (no Copy button) -->
<div
	class="ledger-drawer-mobile-pane-bar flex h-7 flex-none items-stretch border-b border-surface-300-600-token bg-surface-50 dark:bg-surface-900"
	role="tablist"
	aria-label="Drawer panes"
>
	{#each SWIPE_PANES as tab, idx (tab)}
		<button
			type="button"
			role="tab"
			aria-selected={activeIdx === idx}
			data-pane={tab}
			data-status={tab === "note" ? noteStatus : null}
			class="relative flex flex-1 items-center justify-center gap-1 border-b-2 text-3xs font-semibold uppercase tracking-wider {activeIdx === idx
				? 'border-primary-500 text-primary-500'
				: 'border-transparent opacity-55'}"
			on:click={() => onTabPick(idx)}
		>
			<span>{SWIPE_PANE_LABELS[tab]}</span>
			{#if tab === "note" && noteInfo.dot}
				<span class="h-1.5 w-1.5 rounded-full {noteInfo.dot}" aria-hidden="true"></span>
			{/if}
		</button>
	{/each}
</div>

<!-- Unified 120fps GPU swipe stage (no competing overflow-x scroll-snap container) -->
<div
	bind:this={stageEl}
	class="ledger-drawer-mobile-stage relative flex min-h-0 flex-1 overflow-hidden"
	style="touch-action: pan-y"
	on:touchstart={onStageTouchStart}
	on:touchmove|nonpassive={onStageTouchMove}
	on:touchend={onStageTouchEnd}
	on:touchcancel={onStageTouchCancel}
>
	<!-- 4-Pane GPU Carousel Track -->
	<div bind:this={trackEl} class="ledger-drawer-mobile-track gpu-layer flex h-full w-full flex-none">
		<div class="ledger-drawer-request {slidePane}">
			<DrawerEditorPane
				kind="request"
				{details}
				{bodies}
				{syntaxMode}
				{wrap}
				on:suspend={(e) => dispatch("requestsuspend", e.detail)}
			/>
		</div>

		<div class="ledger-drawer-response {slidePane}">
			{#if hasResponse}
				<div
					class="flex h-7 flex-none items-center justify-end border-b border-surface-300-600-token bg-surface-50 px-2 dark:bg-surface-900"
				>
					<ResponseModeToggle bind:mode={responseMode} actionId="ledger.drawer-open.toggle-render" />
				</div>
			{/if}
			<div class="relative flex min-h-0 flex-1 flex-col">
				<DrawerEditorPane
					kind="response"
					{details}
					{bodies}
					{syntaxMode}
					{wrap}
					{hasResponse}
					{hasResponseBody}
					{responseMode}
					{rawResponseBytes}
					{responseContentType}
					{responseStatusCode}
					{responseTruncated}
					{canBrowserView}
					{onBrowserView}
					onShowRaw={() => (responseMode = "raw")}
					on:suspend={(e) => dispatch("responsesuspend", e.detail)}
				/>
			</div>
		</div>

		<div class="ledger-drawer-note-pane {slidePane}">
			<DrawerEditorPane
				kind="note"
				{note}
				{noteFor}
				{noteVersion}
				saveNote={store.saveNote}
				on:noteedit
				on:notestatus
			/>
		</div>

		<div class="ledger-drawer-metadata-slide {slidePane}">
			<DrawerEditorPane kind="metadata" {metadata} />
		</div>
	</div>

	<!-- Always-mounted GPU Scrim -->
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		bind:this={scrimEl}
		class="ledger-drawer-mobile-scrim sidebar-scrim absolute inset-0 z-20 bg-black/40 {uiLeft || uiRight
			? 'pointer-events-auto'
			: 'pointer-events-none'}"
		style="opacity: 0"
		on:click={() => commitSidebars(false, false)}
	></div>

	<!-- Always-mounted Left Details Sidebar -->
	<aside
		bind:this={leftEl}
		class="ledger-drawer-mobile-sidebar ledger-drawer-mobile-left gpu-layer sidebar-contain absolute inset-y-0 left-0 z-30 flex w-[264px] max-w-[84%] flex-col overflow-y-auto border-r border-surface-300-600-token bg-surface-50 text-2xs shadow-xl dark:bg-surface-900 {uiLeft
			? 'pointer-events-auto'
			: 'pointer-events-none'}"
		style="transform: translate3d(-{SWIPE_PANEL_WIDTH}px, 0, 0)"
		aria-label="Request details"
		aria-hidden={!uiLeft}
	>
		<DrawerDetailsContent
			{pair}
			{timing}
			{palette}
			{note}
			{noteStatus}
			noteActive={activeIdx === 2}
			{findings}
			{testCases}
			{indexing}
			{wrapPaused}
			touch
			bind:prettify
			bind:wrap
			on:highlight
			on:openNote={() => onTabPick("note")}
		/>
	</aside>

	<!-- Always-mounted Right Actions Sidebar -->
	<aside
		bind:this={rightEl}
		class="ledger-drawer-mobile-sidebar ledger-drawer-mobile-right gpu-layer sidebar-contain absolute inset-y-0 right-0 z-30 flex w-[264px] max-w-[84%] flex-col overflow-y-auto border-l border-surface-300-600-token bg-surface-50 text-2xs shadow-xl dark:bg-surface-900 {uiRight
			? 'pointer-events-auto'
			: 'pointer-events-none'}"
		style="transform: translate3d({SWIPE_PANEL_WIDTH}px, 0, 0)"
		aria-label="Pair actions"
		aria-hidden={!uiRight}
	>
		<DrawerActionsContent {canOpenStream} {hasResponse} touch on:action={(e) => runAction(e.detail)} />
	</aside>
</div>

<style>
	.gpu-layer {
		will-change: transform;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
	}
	.sidebar-contain {
		contain: layout style paint;
	}
	.sidebar-scrim {
		will-change: opacity;
	}
</style>
