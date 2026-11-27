<script>
	// Narrow-mobile (<= 40rem) body of the Ledger drawer: a clean 100%-width
	// Request | Response | Note | Meta tab bar above one unified 120fps
	// GPU-composited (translate3d) horizontal gesture stage driving both the
	// 4-pane carousel and the mutually exclusive left Details and right Actions
	// slide-over sidebars. Vertical scrolling inside CodeMirror editors and
	// inside open sidebars stays native (touch-action: pan-y + axis lock).
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { javascript } from "@codemirror/lang-javascript";
	import {
		BookCheck,
		CookingPot,
		Copy,
		FileOutput,
		Globe,
		Link,
		Pencil,
		Radio,
		Send,
		Shapes,
		ShieldAlert,
		Sparkles,
		Swords,
		WrapText,
	} from "lucide-svelte";
	import DrawerEditor from "./DrawerEditor.svelte";
	import DrawerFacts from "./DrawerFacts.svelte";
	import DrawerLinked from "./DrawerLinked.svelte";
	import DrawerNote from "./DrawerNote.svelte";
	import { usesSyntax } from "./drawer.js";
	import {
		drawerCopyActions,
		noteIndicator,
		rightRailWorkflowActions,
	} from "./drawerPresentation.js";
	import {
		SWIPE_PANES,
		SWIPE_PANEL_WIDTH,
		SWIPE_PANE_LABELS,
		beginGesture,
		cancelGesture,
		computeTransforms,
		createSwipeState,
		endGesture,
		moveGesture,
		paneIndexFor,
		selectPane,
		setSidebars,
	} from "./drawerSwipe.js";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import { WRAP_SUSPENDED } from "../lineWrap.js";
	import { chefShown } from "../platform.js";

	export let store;
	export let pair;
	export let details = undefined;
	export let bodies = { request: "", response: "" };
	export let note = null;
	export let noteFor = null;
	export let noteVersion = 0;
	export let noteStatus = "saved";
	export let metadata = null;
	export let syntaxMode = "auto";
	export let palette = [];
	export let findings = [];
	export let testCases = [];
	export let timing = "";
	export let hasResponse = false;
	export let hasResponseBody = false;
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
	const jsonLanguage = javascript();
	const EASE = "250ms cubic-bezier(0.22, 1, 0.36, 1)";
	const INDEXING = "Indexing data: some bodies may not show prettified yet";
	const STATUS = { unsaved: "Edited", saving: "Saving…", failed: "Not saved" };
	const ICONS = {
		radio: Radio,
		send: Send,
		swords: Swords,
		shapes: Shapes,
		"cooking-pot": CookingPot,
		"shield-alert": ShieldAlert,
		"book-check": BookCheck,
		copy: Copy,
		"file-output": FileOutput,
		link: Link,
		globe: Globe,
	};

	const initialIdx = pane === "note" ? 2 : pane === "metadata" ? 3 : 0;
	let swipe = createSwipeState({ paneIndex: initialIdx, leftOpen, rightOpen });
	let lastExternalPane = pane;
	let mounted = false;

	let stageEl;
	let trackEl;
	let leftEl;
	let rightEl;
	let scrimEl;
	let rafId = 0;
	let resizeObserver = null;

	function stageWidth() {
		return stageEl?.clientWidth || 390;
	}

	function panelWidth() {
		return leftEl?.offsetWidth || rightEl?.offsetWidth || Math.min(SWIPE_PANEL_WIDTH, Math.round(stageWidth() * 0.84));
	}

	function applyResting(immediate, state = swipe) {
		const resting = computeTransforms(
			state.gesture ? { ...state, gesture: null } : state,
			{ stageWidth: stageWidth(), panelWidth: panelWidth() },
		);
		const t = immediate ? "none" : `transform ${EASE}`;
		const o = immediate ? "none" : `opacity ${EASE}`;
		if (trackEl) {
			trackEl.style.transition = t;
			trackEl.style.transform = `translate3d(${resting.trackX}px, 0, 0)`;
		}
		if (leftEl) {
			leftEl.style.transition = t;
			leftEl.style.transform = `translate3d(${resting.leftX}px, 0, 0)`;
		}
		if (rightEl) {
			rightEl.style.transition = t;
			rightEl.style.transform = `translate3d(${resting.rightX}px, 0, 0)`;
		}
		if (scrimEl) {
			scrimEl.style.transition = o;
			scrimEl.style.opacity = String(resting.scrimOpacity);
		}
	}

	function syncPaneFromIndex(idx) {
		const id = SWIPE_PANES[idx];
		const nextPane = id === "note" ? "note" : id === "metadata" ? "metadata" : null;
		lastExternalPane = nextPane;
		if (nextPane !== pane) dispatch("pane", nextPane);
	}

	function commitSidebars(nextLeft, nextRight) {
		swipe = setSidebars(swipe, { leftOpen: nextLeft, rightOpen: nextRight });
		applyResting(false, swipe);
		if (swipe.leftOpen !== leftOpen || swipe.rightOpen !== rightOpen) {
			dispatch("sidebars", { leftOpen: swipe.leftOpen, rightOpen: swipe.rightOpen });
		}
	}

	function onTabPick(indexOrId) {
		const next = selectPane(swipe, indexOrId);
		const sidebarsChanged = next.leftOpen !== leftOpen || next.rightOpen !== rightOpen;
		swipe = next;
		syncPaneFromIndex(next.paneIndex);
		applyResting(false, next);
		if (sidebarsChanged) {
			dispatch("sidebars", { leftOpen: next.leftOpen, rightOpen: next.rightOpen });
		}
	}

	// Sync sidebar props changed by the command strip corner toggles.
	$: if (!swipe.gesture && (swipe.leftOpen !== leftOpen || swipe.rightOpen !== rightOpen)) {
		swipe = setSidebars(swipe, { leftOpen, rightOpen });
		if (mounted) applyResting(false, swipe);
	}

	// Sync pane prop changed externally (shortcuts, row menu Add note / Metadata).
	$: if (pane !== lastExternalPane) {
		lastExternalPane = pane;
		if (pane === "note" || pane === "metadata") {
			const idx = paneIndexFor(pane);
			if (swipe.paneIndex !== idx) {
				swipe = { ...swipe, paneIndex: idx };
				if (mounted) applyResting(false, swipe);
			}
		} else if (pane === null && swipe.paneIndex >= 2) {
			swipe = { ...swipe, paneIndex: 1 };
			if (mounted) applyResting(false, swipe);
		}
	}

	function renderLiveFrame() {
		rafId = 0;
		const mode = swipe.gesture?.mode;
		if (!mode) return;
		const pos = computeTransforms(swipe, { stageWidth: stageWidth(), panelWidth: panelWidth() });

		if (mode === "pager" && trackEl) {
			trackEl.style.transition = "none";
			trackEl.style.transform = `translate3d(${pos.trackX}px, 0, 0)`;
			return;
		}
		if ((mode === "open-left" || mode === "close-left") && leftEl) {
			leftEl.style.transition = "none";
			leftEl.style.transform = `translate3d(${pos.leftX}px, 0, 0)`;
			if (scrimEl) {
				scrimEl.style.transition = "none";
				scrimEl.style.opacity = String(pos.scrimOpacity);
			}
			return;
		}
		if ((mode === "open-right" || mode === "close-right") && rightEl) {
			rightEl.style.transition = "none";
			rightEl.style.transform = `translate3d(${pos.rightX}px, 0, 0)`;
			if (scrimEl) {
				scrimEl.style.transition = "none";
				scrimEl.style.opacity = String(pos.scrimOpacity);
			}
		}
	}

	function cancelActiveRaf() {
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}

	onMount(() => {
		mounted = true;
		applyResting(true, swipe);
		if (typeof ResizeObserver !== "undefined" && stageEl) {
			resizeObserver = new ResizeObserver(() => {
				if (!swipe.gesture) applyResting(true, swipe);
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
			if (swipe.gesture) {
				cancelActiveRaf();
				swipe = cancelGesture(swipe);
				applyResting(false, swipe);
			}
			return;
		}
		cancelActiveRaf();
		const rect = stageEl.getBoundingClientRect();
		const touch = event.touches[0];
		swipe = beginGesture(swipe, {
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
		const step = moveGesture(swipe, {
			x: touch.clientX,
			y: touch.clientY,
			time: performance.now(),
		});
		swipe = step.state;
		if (step.preventDefault) event.preventDefault();
		if (step.active && !rafId) {
			rafId = requestAnimationFrame(renderLiveFrame);
		}
	}

	function onStageTouchEnd() {
		cancelActiveRaf();
		const { state: next, mode } = endGesture(swipe);
		swipe = next;
		if (!mode) return;

		if (mode === "pager") {
			syncPaneFromIndex(next.paneIndex);
		}
		if (next.leftOpen !== leftOpen || next.rightOpen !== rightOpen) {
			dispatch("sidebars", { leftOpen: next.leftOpen, rightOpen: next.rightOpen });
		}
		applyResting(false, next);
	}

	function onStageTouchCancel() {
		cancelActiveRaf();
		if (!swipe.gesture) return;
		swipe = cancelGesture(swipe);
		applyResting(false, swipe);
	}

	function runAction(actionId) {
		commitSidebars(false, false);
		dispatch("action", actionId);
	}

	$: keymap = $menuDispatcher;
	$: activeIdx = swipe.paneIndex;
	$: uiLeft = swipe.leftOpen;
	$: uiRight = swipe.rightOpen;
	$: noteInfo = noteIndicator(noteStatus, hasNote);
	$: workflow = rightRailWorkflowActions({ canOpenStream, showChef: $chefShown });
	$: copyActions = drawerCopyActions({ hasResponse });
	$: noteTint =
		activeIdx !== 2
			? ""
			: noteStatus === "failed"
				? "text-error-500 !opacity-100"
				: noteStatus !== "saved"
					? "text-warning-500 !opacity-100"
					: "text-surface-900 dark:text-surface-50 !opacity-100";

	const highlightLabel = (h) => (pair.Highlight === h.number ? `${h.label} (click to clear)` : h.label);
	const message = "p-3 text-2xs opacity-50";
	const heading = "px-3 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wide opacity-50";
	const rowBtn =
		"flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs active:bg-surface-200-700-token disabled:cursor-not-allowed disabled:opacity-35";
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
			{#if details === undefined}
				<p class={message}>Loading…</p>
			{:else if details === null}
				<p class={message}>Couldn't read this request.</p>
			{:else}
				<DrawerEditor
					value={bodies.request}
					lang={usesSyntax(bodies.request, syntaxMode) ? "http" : undefined}
					{wrap}
					on:suspend={(e) => dispatch("requestsuspend", e.detail)}
				/>
			{/if}
		</div>

		<div class="ledger-drawer-response {slidePane}">
			{#if details === undefined}
				<p class={message}>Loading…</p>
			{:else if hasResponseBody}
				<DrawerEditor
					value={bodies.response}
					lang={usesSyntax(bodies.response, syntaxMode) ? "http" : undefined}
					{wrap}
					on:suspend={(e) => dispatch("responsesuspend", e.detail)}
				/>
			{:else if details !== null}
				<p class={message}>Waiting for the response…</p>
			{/if}
		</div>

		<div class="ledger-drawer-note-pane {slidePane}">
			{#if note === null}
				<p class={message}>Loading the note…</p>
			{:else}
				{#key `${noteFor}:${noteVersion}`}
					<DrawerNote
						id={noteFor}
						text={note}
						save={store.saveNote}
						on:edit={(e) => dispatch("noteedit", e.detail)}
						on:status={(e) => dispatch("notestatus", e.detail)}
					/>
				{/key}
			{/if}
		</div>

		<div class="ledger-drawer-metadata {slidePane}">
			{#if metadata === null}
				<p class={message}>Loading…</p>
			{:else}
				<DrawerEditor value={metadata} lang={jsonLanguage} wrap />
			{/if}
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
		<DrawerFacts {pair} {timing} prefix="ledger" />

		<div class={heading}>Highlight</div>
		<div class="ledger-drawer-swatches flex flex-none flex-wrap gap-2 px-3 py-1" role="radiogroup" aria-label="Highlight">
			{#each palette as h (h.number)}
				<button
					type="button"
					class="h-4 w-4 rounded-full {pair.Highlight === h.number
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
			data-status={activeIdx === 2 ? noteStatus : null}
		>
			<span>Note</span>
			{#if activeIdx === 2 && STATUS[noteStatus]}
				<span class="ledger-note-status normal-case tracking-normal" role="status">{STATUS[noteStatus]}</span>
			{/if}
			<span class="flex-1"></span>
			<button
				type="button"
				class="ledger-drawer-note-edit flex items-center gap-1 normal-case tracking-normal text-primary-500"
				on:click={() => onTabPick("note")}
			>
				<Pencil size={10} />{hasNote ? "Edit" : "Add"}
			</button>
		</div>
		{#if note}
			<button
				type="button"
				class="ledger-drawer-note-preview mx-3 line-clamp-3 flex-none whitespace-pre-line break-words text-left text-2xs opacity-80"
				title="Open the note"
				on:click={() => onTabPick("note")}>{note}</button
			>
		{:else}
			<p class="mx-3 flex-none text-2xs opacity-40">{note === null ? "…" : "No note"}</p>
		{/if}

		<DrawerLinked {findings} {testCases} />

		<div class={heading}>View</div>
		<label class={rowBtn} title={indexing ? INDEXING : null}>
			<span class="relative flex-none">
				<Sparkles size={14} class={prettify ? "text-primary-500" : "opacity-70"} />
				{#if indexing}
					<span class="ledger-drawer-indexing absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"></span>
				{/if}
			</span>
			<span class="flex-1">Prettify</span>
			<input type="checkbox" class="checkbox h-3.5 w-3.5" bind:checked={prettify} />
		</label>
		<label class="mb-3 {rowBtn}" title={wrapPaused ? WRAP_SUSPENDED : null}>
			<span class="relative flex-none">
				<WrapText size={14} class={wrap ? "text-primary-500" : "opacity-70"} />
				{#if wrapPaused}
					<span class="ledger-drawer-wrap-suspended absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning-500"></span>
				{/if}
			</span>
			<span class="flex-1">Wrap lines</span>
			<input type="checkbox" class="checkbox h-3.5 w-3.5" bind:checked={wrap} />
		</label>
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
		<div class={heading}>Actions</div>
		{#each workflow as action, idx (action.id)}
			{#if idx > 0 && workflow[idx - 1].group !== action.group}
				<div class="mx-3 my-1 flex-none border-t border-surface-300-600-token" aria-hidden="true"></div>
			{/if}
			{@const key = shortcutLabel(keymap, action.actionId)}
			<button
				type="button"
				class="{rowBtn} {action.accent ? 'text-success-500' : ''}"
				on:click={() => runAction(action.actionId)}
			>
				<svelte:component this={ICONS[action.icon]} size={14} class="flex-none opacity-75" />
				<span class="flex-1">{action.label}</span>
				{#if key}
					<kbd class="text-3xs opacity-50">{key}</kbd>
				{/if}
			</button>
		{/each}

		<div class={heading}>Copy</div>
		{#each copyActions as action, idx (action.id)}
			{@const key = shortcutLabel(keymap, action.actionId)}
			<button
				type="button"
				class="{rowBtn} {idx === copyActions.length - 1 ? 'mb-3' : ''}"
				disabled={action.disabled}
				title={action.disabled && action.disabledHint ? action.disabledHint : null}
				on:click={() => runAction(action.actionId)}
			>
				<svelte:component this={ICONS[action.icon]} size={14} class="flex-none opacity-75" />
				<span class="flex-1">{action.label}</span>
				{#if key}
					<kbd class="text-3xs opacity-50">{key}</kbd>
				{/if}
			</button>
		{/each}
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
