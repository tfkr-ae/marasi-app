<script>
	// The Ledger table: one windowed list with fixed-height rows, so only the
	// rows in view render however many the table holds. A highlighted row
	// has a 3px stripe in its colour and a light tint; the stripe stays when
	// the row is selected. Selected rows are tinted; the focused one, which
	// the drawer shows, is also outlined.
	//
	// `rows` is the store's window of loaded pages. The table reports the
	// rows in view (`viewport`) so pages load and drop around them, and when
	// rows are added or dropped above, it keeps the top row in view where it
	// was, so nothing moves under the researcher.
	import { afterUpdate, createEventDispatcher } from "svelte";
	import RowBadges from "./RowBadges.svelte";
	import { textSize } from "../../stores/textSizeStore.js";
	import { ledgerRowHeight } from "../textSize.js";
	import {
		LEDGER_COLUMNS,
		formatSize,
		headerHeight,
		keepRowInPlace,
		pageDistance,
		rowsPerView,
		topRow,
		rowHighlight,
		rowTemplate,
		scrollToReveal,
		shortType,
		meetsFooter,
		meetsHeader,
		scrollToCenter,
		sortAria,
		sortMark,
		sortTitle,
		statusText,
		visibleRange,
	} from "./table.js";
	import { sameID } from "./pairs.js";
	import { METHOD_CLASS, shortTime, statusClass } from "../launchpad/format.js";

	/** The rows, top to bottom. */
	/** True when the drawer's border runs right under the table. */
	export let drawerBelow = false;
	export let rows = [];
	/** The focused pair's ID, or null. */
	export let focusId = null;
	/** The selected pairs' IDs, as strings. */
	export let selectedIds = new Set();
	/** The highlight palette (stores/highlightsStore.js). */
	export let palette = [];
	/** The first row's number for the # column, or null when unknown. */
	/** The sort: { field, desc }. */
	export let sort = null;
	/**
	 * True when rows added at the top should show while the table is
	 * scrolled to the top (the newest-first live view).
	 */
	export let pinTop = false;
	/** Changes when fresh results load from the top; the table scrolls there. */
	export let resetKey = 0;
	/**
	 * True while Marasi reads fresh results: ghost rows fill the view in
	 * place of the rows, which are about to be replaced.
	 */
	export let ghost = false;

	const dispatch = createEventDispatcher();
	const template = rowTemplate(LEDGER_COLUMNS);
	const OVERSCAN = 15;

	let viewport;
	let scrollTop = 0;
	let height = 600;

	// Rows grow with the Text size; every scroll and row-position helper takes this height.
	$: rowHeight = ledgerRowHeight($textSize);
	$: headerPx = headerHeight(rowHeight);
	$: rowsHeight = Math.max(0, height - headerPx);
	$: range = visibleRange({
		scrollTop,
		height: rowsHeight,
		count: rows.length,
		rowHeight,
		overscan: OVERSCAN,
	});
	$: shown = rows.slice(range.start, range.end);
	$: ghostRows = ghost ? rowsPerView(rowsHeight, rowHeight) : 0;
	// Each ghost cell's bar width, as a share of its cell, varied by row so
	// the ghost reads as rows rather than stripes.
	const GHOST_WIDTHS = [
		[0.5, 0, 0.7, 0.5, 0.8, 0.9, 0.5, 0.6, 0.5],
		[0.4, 0, 0.7, 0.6, 0.6, 0.6, 0.5, 0.5, 0.4],
		[0.5, 0, 0.7, 0.4, 0.8, 0.75, 0.5, 0.7, 0.6],
	];

	// The top row in view and how far it is scrolled into, so it can keep
	// its place when the rows change.
	let anchor = { id: null, offset: 0 };
	let laidOut = rows;
	let laidOutReset = resetKey;
	let laidOutRowHeight = ledgerRowHeight($textSize);
	let reported = "";

	// Records the top row in view and reports the rows in view when they
	// changed.
	function noteScroll() {
		const { index: top, offset } = topRow(scrollTop, rowHeight);
		anchor = { id: rows[top]?.ID ?? null, offset };
		const visible = rowsPerView(rowsHeight, rowHeight);
		const lastRow = Math.max(rows.length - 1, 0);
		const view = {
			first: Math.min(top, lastRow),
			last: Math.min(top + visible, lastRow),
			atTop: scrollTop <= 0,
		};
		const key = `${view.first}:${view.last}:${view.atTop}:${rows.length}`;
		if (key === reported) return;
		reported = key;
		dispatch("viewport", view);
	}

	afterUpdate(() => {
		if (!viewport) return;
		if (resetKey !== laidOutReset) {
			// Fresh results: back to the top.
			laidOutReset = resetKey;
			laidOut = rows;
			viewport.scrollTop = 0;
		} else if (rows !== laidOut) {
			// The same results with rows added or dropped around the view.
			laidOut = rows;
			if (!(pinTop && viewport.scrollTop <= 0)) {
				const next = keepRowInPlace({ anchorID: anchor.id, offset: anchor.offset, rows, rowHeight });
				if (next != null && next !== viewport.scrollTop) viewport.scrollTop = next;
			}
		} else if (rowHeight !== laidOutRowHeight) {
			// The Text size changed: the top row in view stays on top.
			const next = keepRowInPlace({ anchorID: anchor.id, offset: 0, rows, rowHeight });
			if (next != null && viewport.scrollTop > 0) viewport.scrollTop = next;
		}
		laidOutRowHeight = rowHeight;
		scrollTop = viewport.scrollTop;
		noteScroll();
	});

	function onScroll() {
		scrollTop = viewport.scrollTop;
		noteScroll();
	}

	/** Scrolls just enough to show the row with this ID. */
	/**
	 * Scrolls row `id` into view: as little as possible, or with `center`
	 * (a jump) into the middle when it is out of view.
	 */
	export function reveal(id, { center = false } = {}) {
		const index = rows.findIndex((row) => sameID(row.ID, id));
		if (!viewport || index < 0) return;
		// Measure now: the bound height lags on the first render.
		const visible = Math.max(0, viewport.clientHeight - headerPx);
		const view = { scrollTop: viewport.scrollTop, height: visible, rowHeight };
		viewport.scrollTop = center ? scrollToCenter(view, index) : scrollToReveal(view, index);
	}
	/** Scrolls a viewport's height down (1) or up (-1). */
	export function page(direction) {
		if (viewport) viewport.scrollTop += direction * pageDistance(rowsHeight, rowHeight);
	}
	export function focus() {
		viewport?.focus();
	}
	/** Scrolls to the first row. */
	export function scrollToTop() {
		if (!viewport) return;
		viewport.scrollTop = 0;
		onScroll();
	}

	// ↑/↓ move the selection (⇧ extends it), ⌘A selects every row, and the
	// menu key or ⇧F10 opens the row menu. Esc belongs to the page.
	function onKeydown(event) {
		const primary = event.metaKey || event.ctrlKey;
		if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
			event.preventDefault();
			dispatch("selectall");
			return;
		}
		if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
			event.preventDefault();
			dispatch("menukey");
			return;
		}
		if (primary || event.altKey) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			dispatch("step", { step: event.key === "ArrowDown" ? 1 : -1, extend: event.shiftKey });
		}
	}

	// Pressing a row selects it: plain starts a drag sweep, ⌘/Ctrl toggles
	// and ⇧ selects a range. Right-clicks belong to the menu.
	let sweeping = false;
	function onRowPointerDown(event, id) {
		if (event.button !== 0) return;
		const toggle = event.metaKey || event.ctrlKey;
		if (toggle || event.shiftKey) {
			dispatch("click", { id, toggle, range: event.shiftKey });
			return;
		}
		sweeping = true;
		dispatch("sweepstart", id);
	}
	function onRowPointerEnter(id) {
		if (sweeping) dispatch("sweep", id);
	}
	function endSweep() {
		if (!sweeping) return;
		sweeping = false;
		dispatch("sweepend");
	}

	/** The on-screen box of the row with this ID, or null when it isn't rendered. */
	export function rowRect(id) {
		const selector = `[data-row="${CSS.escape(String(id))}"]`;
		return viewport?.querySelector(selector)?.getBoundingClientRect() ?? null;
	}

	// Dimmed cells use a translucent text colour, not opacity: WebKit paints
	// an element with opacity as its own layer, sized to the cell's
	// cap-trimmed box, which cut off the tops of its glyphs.
	const dim = "text-black/60 dark:text-surface-50/60";

	// The full content type under the pointer, in one fixed-positioned
	// tooltip for the whole table so the cell doesn't clip it (as the
	// badges' "+N" list does). It hangs from the cell's right edge: Type
	// sits near the window's right side.
	let typeTip = null;
	function showTypeTip(event, contentType) {
		if (!contentType) return;
		const rect = event.currentTarget.getBoundingClientRect();
		typeTip = { text: contentType, right: window.innerWidth - rect.right, top: rect.bottom + 4 };
	}
</script>

<svelte:window on:pointerup={endSweep} on:blur={endSweep} />

<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
	bind:this={viewport}
	bind:clientHeight={height}
	on:scroll={(event) => {
		typeTip = null;
		onScroll(event);
	}}
	on:keydown={onKeydown}
	tabindex="0"
	class="ledger-table no-select relative h-full overflow-auto font-mono focus:outline-none"
	role="grid"
	aria-busy={ghost}
	aria-rowcount={rows.length}
	aria-multiselectable="true"
>
	<div
		class="lg-row sticky top-0 z-10 border-b border-primary-500 bg-surface-100 font-sans text-2xs font-semibold dark:bg-surface-800"
		style="grid-template-columns: {template}; height: {headerPx}px"
		role="row"
	>
		{#each LEDGER_COLUMNS as column (column.key)}
			{@const mark = sortMark(sort, column)}
			{#if column.sort}
				<button
					type="button"
					class="ledger-sort flex h-full items-center gap-0.5 hover:bg-surface-200-700-token {column.align === 'right'
						? 'justify-end'
						: 'justify-start'} {mark ? 'text-primary-500' : ''}"
					role="columnheader"
					aria-sort={sortAria(sort, column)}
					title={sortTitle(sort, column)}
					data-sort={column.sort}
					on:click={() => dispatch("sort", column.sort)}
					><!-- The arrow never truncates, so the sort direction always shows. --><span class="min-w-0 truncate"
						>{column.label}</span
					>{#if mark}<span class="shrink-0">{mark}</span>{/if}</button
				>
			{:else}
				<span role="columnheader">{column.label}</span>
			{/if}
		{/each}
	</div>
	{#if ghost}
		<div class="ledger-ghost" aria-hidden="true">
			{#each { length: ghostRows } as _, i}
				<div
					class="lg-row border-b border-surface-300/50 dark:border-surface-700/60"
					style="grid-template-columns: {template}; height: {rowHeight}px"
				>
					{#each GHOST_WIDTHS[i % GHOST_WIDTHS.length] as width, c}
						<span class="flex items-center {LEDGER_COLUMNS[c]?.align === 'right' ? 'justify-end' : ''}"
							>{#if width}<span
									class="ledger-ghost-bar block h-2 animate-pulse rounded-sm bg-surface-300 dark:bg-surface-600"
									style="width: {width * 100}%; animation-delay: {(i % 6) * 120}ms"
								></span>{/if}</span
						>
					{/each}
				</div>
			{/each}
		</div>
	{:else}
		<div style="height: {rows.length * rowHeight}px; position: relative">
			<div style="position: absolute; left: 0; right: 0; top: {range.start * rowHeight}px">
				{#each shown as row, i (String(row.ID))}
					{@const selected = selectedIds.has(String(row.ID))}
					{@const focused = sameID(row.ID, focusId)}
					{@const onDrawer = focused && drawerBelow && meetsFooter(range.start + i, scrollTop, rowHeight, rowsHeight)}
					{@const color = rowHighlight(row, palette)}
					<!-- svelte-ignore a11y-click-events-have-key-events a11y-interactive-supports-focus -->
					<div
						class="lg-row ledger-row relative border-b {onDrawer
							? 'border-transparent'
							: 'border-surface-300/50 dark:border-surface-700/60'} {selected
							? 'bg-primary-500/25'
							: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
						style="grid-template-columns: {template}; height: {rowHeight}px;{color
							? ` box-shadow: inset 3px 0 0 ${color};`
							: ''}{color && !selected ? ` background-color: ${color}22;` : ''}"
						data-row={String(row.ID)}
						role="row"
						aria-selected={selected}
						on:pointerdown={(event) => onRowPointerDown(event, row.ID)}
						on:pointerenter={() => onRowPointerEnter(row.ID)}
						on:contextmenu|preventDefault={(event) => dispatch("menu", { id: row.ID, event })}
					>
						{#if focused}
							<!-- The focus frame: it covers the row's bottom border, and skips
							     its top edge right under the header, whose border is there. -->
							<span
								class="ledger-focus pointer-events-none absolute inset-x-0 -bottom-px top-0 border border-primary-500 !p-0 {meetsHeader(
									range.start + i,
									scrollTop,
									rowHeight,
								)
									? 'border-t-0'
									: ''} {onDrawer ? 'border-b-0' : ''}"
								aria-hidden="true"
							></span>
						{/if}
						<span class="text-right tabular-nums {dim}"
							>{row.Number || ""}</span
						>
						<span class="flex items-center !overflow-visible !pl-1"><RowBadges {row} /></span>
						<span class={dim}>{shortTime(row.RequestedAt)}</span>
						<span class={METHOD_CLASS[row.Method] ?? ""}>{row.Method ?? ""}</span>
						<span title={row.Host}>{row.Host ?? ""}</span>
						<span title={row.Path}>{row.Path ?? ""}</span>
						<span class="text-right {statusClass(row.StatusCode)}">{statusText(row.StatusCode)}</span>
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<span
							class="ledger-type {dim}"
							aria-label={row.ContentType || undefined}
							on:mouseenter={(event) => showTypeTip(event, row.ContentType)}
							on:mouseleave={() => (typeTip = null)}>{shortType(row.ContentType)}</span
						>
						<span class="text-right {dim}">{formatSize(row.Length)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#if typeTip}
	<div
		class="ledger-type-tip pointer-events-none fixed z-[80] max-w-[36rem] break-all border border-surface-300-600-token bg-surface-100-800-token px-2 py-1 font-mono text-2xs shadow-xl"
		style="right: {typeTip.right}px; top: {typeTip.top}px"
		role="tooltip"
	>
		{typeTip.text}
	</div>
{/if}

<style>
	.lg-row {
		display: grid;
		align-items: center;
		font-size: 0.6875rem;
		white-space: nowrap;
		min-width: 45.875rem;
	}
	/* Each cell's box is trimmed to its capitals, so the row centres the
	   text itself rather than a line box whose glyph position depends on
	   the engine's font metrics (WebKit drew it ~2px low). Clipping only
	   sideways keeps the ellipsis and lets descenders show. */
	.lg-row > :global(*) {
		overflow-x: clip;
		overflow-y: visible;
		text-overflow: ellipsis;
		text-box: trim-both cap alphabetic;
		padding: 0 6px;
	}
	/* Skeleton's [data-sort]::after gives every sortable header a hidden
	   arrow and margin, which truncated the labels and our own arrow. */
	.ledger-sort::after {
		content: none !important;
		margin: 0 !important;
	}
</style>
