<script>
	// The Ledger's row context menu. Its header sums up the selection, a
	// type-to-filter box searches every action (submenus included), and the
	// keys work as in a native menu: ↑↓ move, → or ↵ open a submenu, ←
	// goes back, ↵ runs, Esc closes. The items come from rowMenu.js, computed
	// from the selected pairs; choosing one dispatches `action` with the
	// item's action for the page to run. The highlight swatches sit on one
	// row: ←→ move between them there, and hovering one shows its label.
	// Another list of pairs (the Launchpad tree's entries) passes its own
	// `items` in the same shape, with its `noun` and `scope` for the header.
	import { createEventDispatcher, tick } from "svelte";
	import {
		ArrowDown,
		ArrowDownToLine,
		ArrowUp,
		ArrowUpToLine,
		Braces,
		BookCheck,
		Check,
		ChevronRight,
		Copy,
		Eraser,
		EyeOff,
		Filter,
		FolderInput,
		Globe,
		Highlighter,
		Link,
		ListChecks,
		Minus,
		Pen,
		Plus,
		Radio,
		Search,
		Send,
		ShieldAlert,
		Swords,
		Trash2,
		Unlink,
		X,
	} from "lucide-svelte";
	import { placeMenu, placeSubmenu } from "./menuPlacement.js";
	import { filterMenu, isPartialSelection, isRunnable, isSwatchRow, menuFor, selectionSummary } from "./rowMenu.js";
	import { menuDispatcher } from "../keybindings/app.js";
	import { shortcutLabel } from "../keybindings/keys.js";
	import { METHOD_CLASS, statusClass } from "../launchpad/format.js";
	import { plural } from "./counts.js";
	import { statusText } from "./table.js";

	/** Whether the menu shows. The menu closes itself by setting it false. */
	export let open = false;
	/** Where it opens, in viewport px. */
	export let x = 0;
	export let y = 0;
	/** The selected pairs, in table order. */
	export let pairs = [];
	/**
	 * What the menu lists besides the pairs (see menuFor in rowMenu.js), plus
	 * `numberOf(pair)` for the numbers in the header.
	 */
	export let context = {};
	/** The items, when not the Ledger's menuFor(pairs, context). */
	export let items = null;
	/** What the header counts the pairs as: [one, many]. */
	export let noun = ["request", "requests"];
	/** Where the pairs are, shown after the count ("in Login"); hosts when null. */
	export let scope = null;
	/** Whether the footer hints at ⇧-click, for tables that multi-select. */
	export let extendHint = true;

	const dispatch = createEventDispatcher();

	const ICONS = {
		radio: Radio,
		send: Send,
		plus: Plus,
		swords: Swords,
		finding: ShieldAlert,
		testcase: BookCheck,
		pen: Pen,
		copy: Copy,
		filter: Filter,
		select: ListChecks,
		braces: Braces,
		link: Link,
		unlink: Unlink,
		"eye-off": EyeOff,
		highlighter: Highlighter,
		trash: Trash2,
		eraser: Eraser,
		move: FolderInput,
		top: ArrowUpToLine,
		up: ArrowUp,
		down: ArrowDown,
		bottom: ArrowDownToLine,
		globe: Globe,
	};
	const SEVERITY_CLASS = {
		Critical: "bg-red-600 text-white",
		High: "bg-orange-500 text-white",
		Medium: "bg-yellow-500 text-black",
		Low: "bg-blue-500 text-white",
		Informational: "bg-surface-500 text-white",
	};

	let root;
	let filterBox;
	let filter = "";
	// The highlighted item in the main list; -1 for none.
	let active = -1;
	// The open submenus, outermost first: subs[k] is level k + 1, opened from
	// item `index` of the level above (the main list for k = 0), with its
	// highlighted item `active` and its place on screen.
	let subs = [];
	// The level the keys act on: 0 for the main list, k for subs[k - 1].
	let keyLevel = 0;
	// The swatch picked out on the highlight row, by keys or the pointer.
	let swatchActive = 0;
	let position = { left: 0, top: 0 };
	const subPanels = [];

	$: menuItems = !open ? [] : items ?? menuFor(pairs, context);
	$: list = filterMenu(menuItems, filter);
	$: filtered = filter.trim() !== "";
	$: summary = open ? selectionSummary(pairs) : null;
	$: levelItems = subItemsOf(list, subs);

	// The items of every open submenu, level by level.
	function subItemsOf(list, subs) {
		const out = [];
		let parent = list;
		for (const sub of subs) {
			const children = Array.isArray(parent[sub.index]?.sub) ? parent[sub.index].sub : [];
			out.push(children);
			parent = children;
		}
		return out;
	}
	// The items of level `level`: the main list, or a submenu.
	const itemsAt = (level) => (level === 0 ? list : levelItems[level - 1] ?? []);

	$: if (open) place();
	$: if (!open) reset();
	// A new filter starts at its first match.
	$: onFilter(filter, list);
	function onFilter() {
		active = filtered ? step(list, -1, 1) : -1;
		closeFrom(0);
	}

	function reset() {
		filter = "";
		active = -1;
		subs = [];
		keyLevel = 0;
		swatchActive = 0;
	}

	// `refocus` is false when the researcher clicked elsewhere, which keeps focus.
	function close(refocus = true) {
		open = false;
		dispatch("close", { refocus });
	}

	// Opens at the pointer: see placeMenu.
	async function place() {
		position = { left: x, top: y };
		await tick();
		if (!root) return;
		const rect = root.getBoundingClientRect();
		position = placeMenu({ x, y, width: rect.width, height: rect.height, viewport: viewportSize() });
		filterBox?.focus({ preventScroll: true });
	}

	const viewportSize = () => ({ width: innerWidth, height: innerHeight });

	// Closes the submenus at `level` and deeper (level 0 closes them all).
	function closeFrom(level) {
		if (subs.length > level) subs = subs.slice(0, level);
		if (keyLevel > level) keyLevel = level;
	}

	// How many submenu levels open from `item`: 1 for a plain submenu.
	function subDepth(item) {
		if (!Array.isArray(item?.sub)) return 0;
		return 1 + Math.max(0, ...item.sub.map(subDepth));
	}

	// Opens the submenu of item `index` of level `level` beside its row: see
	// placeSubmenu. It is measured hidden first.
	async function openSub(level, index) {
		if (subs[level]?.index === index) return;
		subs = [...subs.slice(0, level), { index, active: -1, style: "visibility: hidden" }];
		await tick();
		const panel = subPanels[level];
		const parent = level === 0 ? root : subPanels[level - 1];
		const row = parent?.querySelector(`[data-menu-index="${index}"]`);
		if (!panel || !row || !parent) return;
		const place = placeSubmenu({
			row: row.getBoundingClientRect(),
			parent: parent.getBoundingClientRect(),
			width: panel.offsetWidth,
			height: panel.scrollHeight + 2,
			viewport: viewportSize(),
			levels: level === 0 ? Math.max(1, subDepth(itemsAt(0)[index])) : 1,
			parentLeftward: level > 0 ? subs[level - 1].leftward : null,
		});
		subs[level] = {
			...subs[level],
			leftward: place.leftward,
			style: `left: ${place.left}px; top: ${place.top}px; max-height: ${place.maxHeight}px`,
		};
	}

	function choose(item, level = 0, index = -1) {
		if (!isRunnable(item)) return;
		if (isSwatchRow(item)) {
			choose(item.swatches[swatchActive]);
			return;
		}
		if (Array.isArray(item.sub)) {
			enterSub(level, index);
			return;
		}
		close();
		dispatch("action", item.action);
	}

	// The next runnable item from `from` in direction `d`, wrapping around.
	function step(items, from, d) {
		for (let k = 1; k <= items.length; k++) {
			const i = (((from + d * k) % items.length) + items.length) % items.length;
			if (isRunnable(items[i])) return i;
		}
		return from;
	}

	// The highlighted item of level `level`.
	const activeAt = (level) => (level === 0 ? active : subs[level - 1]?.active ?? -1);
	function setActive(level, index) {
		if (level === 0) active = index;
		else if (subs[level - 1]) subs[level - 1] = { ...subs[level - 1], active: index };
	}

	// Opens the submenu of item `index` of `level` and moves the keys into it.
	async function enterSub(level, index) {
		await openSub(level, index);
		keyLevel = level + 1;
		setActive(level + 1, step(itemsAt(level + 1), -1, 1));
	}

	// The pointer on item `index` of `level`: it is highlighted, deeper
	// submenus close, and its own submenu opens.
	function hover(level, index, item) {
		setActive(level, index);
		keyLevel = level;
		closeFrom(level);
		if (Array.isArray(item.sub) && !item.disabled) openSub(level, index);
	}

	function onKeydown(event) {
		if (!open) return;
		const handled = () => {
			event.preventDefault();
			event.stopPropagation();
		};
		const level = keyLevel;
		const levelList = itemsAt(level);
		const current = levelList[activeAt(level)];
		if (event.key === "Escape") {
			handled();
			if (level > 0) closeFrom(level - 1);
			else if (subs.length) closeFrom(0);
			else close();
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			handled();
			setActive(level, step(levelList, activeAt(level), event.key === "ArrowDown" ? 1 : -1));
			closeFrom(level);
		} else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && level === 0 && isSwatchRow(current)) {
			handled();
			const count = current.swatches.length;
			swatchActive = (swatchActive + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
		} else if (event.key === "ArrowRight") {
			if (Array.isArray(current?.sub) && isRunnable(current)) {
				handled();
				enterSub(level, activeAt(level));
			}
		} else if (event.key === "ArrowLeft") {
			if (level > 0) {
				handled();
				closeFrom(level - 1);
			}
		} else if (event.key === "Enter") {
			handled();
			if (current) choose(current, level, activeAt(level));
		} else if (event.key === "Tab") {
			handled();
		}
	}

	function onPointerDown(event) {
		if (open && root && !root.contains(event.target)) close(false);
	}

	// The item's current shortcut from the keybinding profile, if it has one.
	function shortcut(item, keymap) {
		return item.kbd || shortcutLabel(keymap, item.actionId);
	}

	// A ⌘A selection counts every match, not just the loaded pairs. While it
	// holds pairs the table hasn't loaded, the header names only its count:
	// the loaded pairs' hosts, methods and statuses would mislead.
	$: partial = isPartialSelection(pairs, context);
	$: selectionLabel = !summary
		? ""
		: context.all
			? context.count == null
				? "All matching"
				: `All ${context.count.toLocaleString()} matching`
			: plural(summary.count, ...noun);
</script>

<svelte:window on:keydown|capture={onKeydown} on:pointerdown|capture={onPointerDown} on:blur={() => open && close(false)} />

{#if open && summary}
	<div
		bind:this={root}
		tabindex="-1"
		class="ledger-row-menu fixed z-50 w-72 border border-surface-300-600-token bg-surface-100-800-token text-xs shadow-2xl"
		style="left: {position.left}px; top: {position.top}px"
		role="menu"
		aria-label="Actions for {selectionLabel}"
		on:contextmenu|preventDefault
	>
		<!-- What the menu acts on. -->
		<div class="border-b border-primary-500 px-3 py-2">
			{#if pairs.length === 1 && !context.all}
				{@const pair = pairs[0]}
				<div class="flex items-center gap-2 font-mono">
					<span class="opacity-60">#{context.numberOf?.(pair) ?? ""}</span>
					<span class={METHOD_CLASS[pair.Method] ?? ""}>{pair.Method}</span>
					<span class="ml-auto {statusClass(pair.StatusCode)}">{statusText(pair.StatusCode)}</span>
				</div>
				<div class="mt-0.5 truncate font-mono text-[11px] opacity-70" title="{pair.Host}{pair.Path}">
					{pair.Host}{pair.Path}
				</div>
			{:else}
				<div class="flex items-center gap-2">
					<span class="font-semibold">{selectionLabel}</span>
					{#if scope}<span class="truncate opacity-60">· {scope}</span>
					{:else if !partial}<span class="opacity-60">· {plural(summary.hosts.length, "host")}</span>{/if}
				</div>
				{#if !partial}
				<div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px]">
					{#each summary.methods as [method, count]}
						<span class={METHOD_CLASS[method] ?? ""}>{method} {count}</span>
					{/each}
					{#if summary.classes.length}
						<span class="opacity-30">|</span>
						{#each summary.classes as [statusGroup, count]}
							<span class={statusClass(Number(statusGroup[0]) * 100)}>{statusGroup} {count}</span>
						{/each}
					{/if}
				</div>
				{/if}
			{/if}
		</div>

		<div class="flex items-center gap-2 border-b border-surface-300-600-token px-3 py-1.5">
			<Search size={12} class="opacity-50" />
			<input
				bind:this={filterBox}
				bind:value={filter}
				class="ledger-row-menu-filter min-w-0 flex-1 border-0 bg-transparent p-0 text-xs focus:outline-none focus:ring-0"
				placeholder="Type an action…"
				spellcheck="false"
				autocomplete="off"
				aria-label="Filter actions"
			/>
			{#if filter}
				<button
					type="button"
					class="opacity-60 hover:opacity-100"
					aria-label="Clear the filter"
					on:click={() => {
						filter = "";
						filterBox?.focus();
					}}><X size={12} /></button
				>
			{/if}
		</div>

		<div class="relative py-1">
			{#each list as item, i}
				{#if item === "sep"}
					<div class="my-1 border-t border-surface-300-600-token"></div>
				{:else if item.heading}
					<div class="px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide opacity-50">{item.heading}</div>
				{:else if isSwatchRow(item)}
					<!-- svelte-ignore a11y-mouse-events-have-key-events -->
					<div
						data-menu-index={i}
						data-menu-item={item.id}
						class="ledger-highlight-swatches flex items-center gap-1 px-3 py-[5px] {active === i ? 'bg-primary-500/20' : ''}"
						role="group"
						aria-label={item.label}
						on:mouseenter={() => hover(0, i, item)}
					>
						<span class="w-4 flex-none opacity-70"><Highlighter size={13} /></span>
						{#each item.swatches as swatch, k (swatch.id)}
							<button
								type="button"
								data-menu-item={swatch.id}
								role="menuitemradio"
								aria-checked={swatch.checked === true ? "true" : swatch.checked === "mixed" ? "mixed" : "false"}
								aria-label="Highlight: {swatch.label}"
								aria-disabled={swatch.disabled ? "true" : undefined}
								title={swatch.disabled ? `${swatch.label}: ${swatch.hint}` : swatch.label}
								class="flex h-4 w-4 flex-none items-center justify-center rounded-full border
									{swatch.color ? 'border-transparent' : 'border-surface-500'}
									{swatch.checked === true ? 'ring-2 ring-surface-900 dark:ring-surface-50' : swatch.checked === 'mixed' ? 'ring-1 ring-surface-500' : ''}
									{active === i && swatchActive === k ? 'outline outline-2 outline-offset-1 outline-primary-500' : ''}
									{swatch.disabled ? 'cursor-not-allowed opacity-30' : ''}"
								style={swatch.color ? `background: ${swatch.color}` : ""}
								on:mouseenter={() => (swatchActive = k)}
								on:mousedown|preventDefault
								on:click={() => choose(swatch)}
							>
								{#if !swatch.color}<X size={10} class="opacity-70" />{/if}
							</button>
						{/each}
						<span class="ml-1 min-w-0 flex-1 truncate text-right text-[10px] opacity-70"
							>{active === i
								? (item.swatches[swatchActive]?.disabled
									? `${item.swatches[swatchActive].label}: ${item.swatches[swatchActive].hint}`
									: item.swatches[swatchActive]?.label) ?? ""
								: item.label}</span
						>
					</div>
				{:else}
					{@const key = shortcut(item, $menuDispatcher)}
					<button
						type="button"
						data-menu-index={i}
						data-menu-item={item.id}
						role="menuitem"
						aria-disabled={item.disabled ? "true" : undefined}
						aria-haspopup={Array.isArray(item.sub) ? "menu" : undefined}
						aria-expanded={Array.isArray(item.sub) ? subs[0]?.index === i : undefined}
						class="flex w-full items-center gap-2 px-3 py-[5px] text-left
							{item.disabled ? 'cursor-not-allowed opacity-40' : ''}
							{item.danger ? 'text-error-600 dark:text-error-400' : ''}
							{(active === i || subs[0]?.index === i) && !item.disabled ? 'bg-primary-500/20' : ''}"
						title={item.disabled ? item.hint : ""}
						on:mouseenter={() => hover(0, i, item)}
						on:mousedown|preventDefault
						on:click={() => choose(item, 0, i)}
					>
						<span class="w-4 flex-none opacity-70">
							{#if item.color !== undefined}
								<span
									class="block h-3 w-3 rounded-full border {item.color ? 'border-transparent' : 'border-surface-500'}"
									style={item.color ? `background: ${item.color}` : ""}
								></span>
							{:else if ICONS[item.icon]}<svelte:component this={ICONS[item.icon]} size={13} />{/if}
						</span>
						<span class="min-w-0 flex-1 truncate">
							{#if item.trail?.length}<span class="opacity-50">{item.trail.join(" › ")} › </span>{/if}{item.label}
						</span>
						{#if item.badge}<span class="badge variant-soft-primary px-1.5 py-0 text-[10px]">{item.badge}</span>{/if}
						{#if item.disabled && item.hint}<span class="text-[10px] opacity-80">{item.hint}</span>{/if}
						{#if key && !item.disabled}<kbd class="font-sans text-[10px] opacity-50">{key}</kbd>{/if}
						{#if Array.isArray(item.sub) && !item.disabled}<ChevronRight size={12} class="opacity-60" />{/if}
					</button>
				{/if}
			{:else}
				<p class="px-3 py-2 opacity-50">No matching actions</p>
			{/each}

			{#each subs as panel, k (k)}
				{@const level = k + 1}
				<div
					bind:this={subPanels[k]}
					class="ledger-row-submenu fixed z-10 w-72 overflow-auto border border-surface-300-600-token bg-surface-100-800-token py-1 shadow-2xl"
					style={panel.style}
					data-menu-level={level}
					role="menu"
					aria-label={itemsAt(k)[panel.index]?.label}
				>
					{#each levelItems[k] ?? [] as item, j}
						{#if item === "sep"}
							<div class="my-1 border-t border-surface-300-600-token"></div>
						{:else if item.heading}
							<div class="px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide opacity-50">{item.heading}</div>
						{:else}
							{@const key = shortcut(item, $menuDispatcher)}
							{@const opensSub = Array.isArray(item.sub)}
							<button
								type="button"
								data-menu-index={j}
								data-menu-item={item.id}
								role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
								aria-checked={item.checked === undefined ? undefined : String(item.checked)}
								aria-disabled={item.disabled ? "true" : undefined}
								aria-haspopup={opensSub ? "menu" : undefined}
								aria-expanded={opensSub ? subs[level]?.index === j : undefined}
								class="flex w-full items-center gap-2 px-3 py-[5px] text-left
									{item.disabled ? 'cursor-not-allowed opacity-40' : ''}
									{item.danger ? 'text-error-600 dark:text-error-400' : ''}
									{(panel.active === j || subs[level]?.index === j) && !item.disabled ? 'bg-primary-500/20' : ''}"
								title={item.disabled ? item.hint : item.label}
								on:mouseenter={() => hover(level, j, item)}
								on:mousedown|preventDefault
								on:click={() => choose(item, level, j)}
							>
								<span class="w-4 flex-none opacity-70">
									{#if item.checked === true}<Check size={13} class="text-primary-500" />
									{:else if item.checked === "mixed"}<Minus size={13} class="text-primary-500" />
									{:else if ICONS[item.icon]}<svelte:component this={ICONS[item.icon]} size={13} />{/if}
								</span>
								<span class="min-w-0 flex-1 truncate">{item.label}</span>
								{#if item.severity && SEVERITY_CLASS[item.severity]}
									<span class="px-1 text-[9px] font-bold {SEVERITY_CLASS[item.severity]}">{item.severity}</span>
								{/if}
								{#if item.disabled && item.hint}<span class="text-[10px]">{item.hint}</span>
								{:else if item.count != null}<span class="text-[10px] opacity-50">{item.count}</span>{/if}
								{#if key && !item.disabled}<kbd class="font-sans text-[10px] opacity-50">{key}</kbd>{/if}
								{#if opensSub && !item.disabled}<ChevronRight size={12} class="opacity-60" />{/if}
							</button>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
		<div class="flex justify-between border-t border-surface-300-600-token px-3 py-1 text-[10px] opacity-50">
			<span>↑↓ move · → open · ↵ run</span>
			{#if extendHint}<span>⇧-click to extend</span>{/if}
		</div>
	</div>
{/if}
