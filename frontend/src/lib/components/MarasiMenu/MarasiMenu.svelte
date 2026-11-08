<script>
	// The Marasi menu (⌘K) with menu groups. menuModel.js builds the menu and
	// answers which entry a key picks and what a search matches; this draws
	// it and keeps the open group, the search text and the highlight. Keep ⌘
	// (Ctrl on Windows/Linux) held after ⌘K: ⌘ + a menu letter opens a group,
	// and inside it an action's own binding runs it. Typing searches.
	import { onMount, tick } from "svelte";
	import { ChevronRight, CornerDownLeft, Search } from "lucide-svelte";
	import {
		globalMenuEntries,
		menuDispatcher,
		menuPalettes,
	} from "../../keybindings/app.js";
	import { bindingFromEvent, formatBinding } from "../../keybindings/keys.js";
	import { MACOS } from "../../keybindings/platform.js";
	import { buildMenu, entryForKey, searchMenu } from "./menuModel.js";
	import { groupIcon, groupTone, NEUTRAL_TONE } from "./groupStyle.js";
	import MenuKeys from "./MenuKeys.svelte";

	// The page's entries: { actionId, icon }, optionally with a live name,
	// subtitle or keywords. Text not given comes from the catalog. The
	// Marasi section lists the global entries GlobalMenu publishes. The
	// global tier passes no page entries, so it shows only that section.
	export let pageEntries = [];
	// The page section's heading, in the primary colour.
	export let pageName = "";
	// Menu-context tier: the menu shortcut opens the most specific mounted
	// menu (overlay, then page, then global).
	export let paletteTier = "global";

	let dialog;
	let input;
	let query = "";
	let groupId = null;
	let active = 0;
	let primaryHeld = false;
	let missedKey = "";
	let missedTimer;

	export async function toggle() {
		if (dialog.open) return close();
		query = "";
		groupId = null;
		active = 0;
		primaryHeld = false;
		lastPointer = null;
		dialog.showModal();
		await tick();
		input?.focus();
	}
	function close() {
		if (dialog?.open) dialog.close();
	}

	// The menu opens under a still pointer, and the WebView reports a
	// mousemove for it; only a pointer that has really moved since the menu
	// opened moves the highlight.
	let lastPointer = null;
	function hover(event, index) {
		const at = `${event.screenX},${event.screenY}`;
		const moved = lastPointer !== null && lastPointer !== at;
		lastPointer = at;
		if (moved) active = index;
	}

	$: platform = $menuDispatcher.platform;
	$: primaryName = platform === MACOS ? "⌘" : "Ctrl";
	$: menu = buildMenu({
		catalog: $menuDispatcher.catalog,
		pageEntries,
		globalEntries: $globalMenuEntries,
		bindingsFor: $menuDispatcher.bindingsFor,
		platform,
		letters: $menuDispatcher.letters,
	});
	$: group = groupId ? menu.sections.flatMap((s) => s.groups).find((g) => g.id === groupId) : null;
	$: searching = query.trim() !== "";

	// The drawn rows: section headings and rows at the top, else the
	// matches at the open level.
	$: rows =
		searching || group
			? searchMenu(menu, { group: groupId, query })
			: menu.sections.flatMap((section) => [
					{ heading: section.scope === "page" ? pageName : "Marasi", scope: section.scope },
					...section.rows,
				]);
	$: selectable = rows.filter((row) => !row.heading);
	$: indexOf = new Map(selectable.map((row, i) => [row, i]));
	$: query, groupId, (active = 0);
	$: current = selectable[active];

	function openGroup(id) {
		groupId = id;
		query = "";
		active = 0;
		input?.focus();
	}

	function pick(row) {
		if (!row) return;
		if (row.kind === "group") return openGroup(row.id);
		close();
		if (row.actionId) menuDispatcher.run(row.actionId);
	}

	function missed(binding) {
		missedKey = binding;
		clearTimeout(missedTimer);
		missedTimer = setTimeout(() => (missedKey = ""), 900);
	}

	const MODIFIER_KEYS = new Set(["meta", "control", "shift", "alt", "os"]);

	async function onKeydown(event) {
		const key = event.key?.toLowerCase();
		if (key === "meta" || key === "control") primaryHeld = true;
		const primaryDown =
			platform === MACOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
		if (primaryDown && !searching && !MODIFIER_KEYS.has(key)) {
			const binding = bindingFromEvent(event);
			// The menu shortcut reaches the dispatcher, which closes the menu.
			if (!binding || $menuDispatcher.bindingsFor("global.open-menu").includes(binding)) return;
			event.preventDefault();
			event.stopPropagation();
			const entry = entryForKey(menu, { group: groupId, query, binding });
			if (entry) pick(entry);
			else missed(binding);
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			active = (active + 1) % Math.max(1, selectable.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			active = (active - 1 + selectable.length) % Math.max(1, selectable.length);
		} else if (event.key === "Enter") {
			event.preventDefault();
			pick(current);
		} else if (
			event.key === "ArrowRight" &&
			current?.kind === "group" &&
			input.selectionStart === query.length
		) {
			event.preventDefault();
			pick(current);
		} else if ((event.key === "Backspace" || event.key === "ArrowLeft") && query === "" && groupId) {
			event.preventDefault();
			groupId = null;
		}
		await tick();
		dialog?.querySelector("[data-menu-active]")?.scrollIntoView({ block: "nearest" });
	}
	function onKeyup(event) {
		const key = event.key?.toLowerCase();
		if (key === "meta" || key === "control") primaryHeld = false;
	}

	function handleClickOutside(event) {
		const rect = dialog.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		) {
			close();
		}
	}

	function toneOf(row) {
		if (row.kind === "group") return groupTone(row);
		return row.group ? groupTone(row.group) : NEUTRAL_TONE;
	}

	// An action's real bindings, and the footer's note on them.
	$: realBindings =
		current && current.kind !== "group" && current.actionId
			? $menuDispatcher.bindingsFor(current.actionId)
			: [];

	onMount(() => menuPalettes.register(paletteTier, { toggle }));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<dialog
	class="w-[40rem] max-w-[92vw] overflow-hidden border border-surface-300-600-token bg-surface-50-900-token p-0 text-surface-900-50-token shadow-2xl"
	bind:this={dialog}
	on:click={handleClickOutside}
	on:cancel|preventDefault={close}
	on:keyup={onKeyup}
	aria-label="Marasi commands"
	aria-modal="true"
>
	<div class="flex items-center gap-2 border-b border-surface-300-600-token px-4 py-3">
		<Search size="16" class="flex-none opacity-50" />
		{#if group}
			{@const icon = groupIcon(group)}
			<button
				type="button"
				class="flex flex-none items-center gap-1.5 px-2 py-0.5 text-xs font-semibold {groupTone(group).chip}"
				on:click={() => {
					groupId = null;
					input.focus();
				}}
				title="Back (⌫)"
			>
				{#if icon}<svelte:component this={icon} size="12" />{/if}
				{group.label}
			</button>
		{/if}
		<input
			id="commandmenu"
			bind:this={input}
			bind:value={query}
			on:keydown={onKeydown}
			class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm focus:outline-none focus:ring-0"
			placeholder={group ? `Search ${group.label}…` : "Search actions…"}
			spellcheck="false"
			autocomplete="off"
			aria-label="Search commands"
		/>
	</div>

	<div class="max-h-[58vh] overflow-y-auto p-1.5">
		{#each rows as row}
			{#if row.heading !== undefined}
				<div class="flex items-center gap-2 px-2.5 pb-1.5 pt-3">
					<span class="h-3 w-1 flex-none {row.scope === 'page' ? 'bg-primary-500' : 'bg-tertiary-500'}"></span>
					<span
						class="text-2xs font-bold uppercase tracking-wider {row.scope === 'page'
							? 'text-primary-600 dark:text-primary-400'
							: 'text-tertiary-700 dark:text-tertiary-400'}">{row.heading}</span
					>
					<span
						class="h-px flex-1 bg-gradient-to-r to-transparent {row.scope === 'page'
							? 'from-primary-500/40'
							: 'from-tertiary-500/50'}"
					></span>
				</div>
			{:else}
				{@const index = indexOf.get(row)}
				{@const isActive = index === active}
				{@const tone = toneOf(row)}
				{@const icon = row.kind === "group" ? groupIcon(row) : null}
				{@const tag = row.kind !== "group" && !group && searching ? row.group : null}
				<button
					type="button"
					data-menu-active={isActive ? "" : undefined}
					class="relative flex w-full items-center gap-3 px-2.5 py-1.5 text-left {isActive
						? 'bg-surface-200-700-token'
						: ''}"
					on:mousemove={(event) => hover(event, index)}
					on:mousedown|preventDefault
					on:click={() => pick(row)}
				>
					{#if isActive}<span class="absolute inset-y-1.5 left-0 w-0.5 {tone.bar}"></span>{/if}
					<span
						class="flex h-7 w-7 flex-none items-center justify-center {row.kind === 'group' || row.group
							? tone.tile
							: NEUTRAL_TONE.tile}"
					>
						{#if icon}
							<svelte:component this={icon} size="15" />
						{:else if row.icon}
							<svelte:component
								this={row.icon.component || row.icon}
								{...row.icon.props || {}}
								size="14"
								class="h-3.5 w-3.5"
							/>
						{/if}
					</span>
					<span class="min-w-0 flex-1">
						{#if row.kind === "group"}
							<span class="flex items-baseline gap-2.5 truncate">
								<span class="text-sm font-semibold">{row.label}</span>
								<span class="truncate text-xs opacity-60">{row.description}</span>
							</span>
						{:else}
							<span class="block truncate text-sm">
								{#if tag}<span class="mr-1 px-1.5 py-px text-2xs font-semibold {groupTone(tag).chip}"
										>{tag.label}</span
									>{/if}
								{row.name}
							</span>
						{/if}
					</span>
					<!-- Keys end at the same x on every row: the chevron slot is
					     always there, so actions line up with groups. -->
					<span class="ml-auto flex flex-none items-center gap-2">
						{#if row.kind === "group"}
							<span
								class="inline-flex h-6 min-w-[1.5rem] items-center justify-center px-1.5 text-xs font-semibold leading-none {tone.chip}"
								>{row.items.length}</span
							>
						{/if}
						<span class="flex items-center justify-end gap-1">
							{#if !searching && row.menuKey}
								<MenuKeys bindings={[row.menuKey]} {platform} />
							{:else if row.kind !== "group" && row.actionId}
								<MenuKeys bindings={$menuDispatcher.bindingsFor(row.actionId)} {platform} />
							{/if}
						</span>
						<span class="flex w-3.5 flex-none justify-center">
							{#if row.kind === "group"}<ChevronRight size="14" class="opacity-50" />{/if}
						</span>
					</span>
				</button>
			{/if}
		{:else}
			<div class="px-3 py-6 text-center text-xs opacity-60">No actions match “{query}”</div>
		{/each}
	</div>

	<div
		class="flex items-center gap-3 border-t border-surface-300-600-token bg-surface-100-800-token px-4 py-2 text-2xs"
	>
		<span class="min-w-0 flex-1 truncate opacity-70">
			{#if missedKey}
				<b>{formatBinding(missedKey, platform)}</b> isn't a menu key here
			{:else if current?.kind === "group"}
				{current.description} · {current.items.length} actions
			{:else if current}
				{current.subtitle ?? current.name}
			{/if}
		</span>
		{#if !searching && current && current.kind !== "group" && realBindings.length}
			{#if !realBindings.includes(current.menuKey)}
				<span class="flex flex-none items-center gap-1.5 opacity-80"
					>Outside the menu <MenuKeys bindings={realBindings} {platform} /></span
				>
			{:else}
				<span class="flex-none opacity-60">Same key outside the menu</span>
			{/if}
		{/if}
		<span class="flex flex-none items-center gap-2 opacity-60">
			<span class="flex items-center gap-1"
				><CornerDownLeft size="11" />
				{current?.kind === "group" ? "open" : "run"}</span
			>
			{#if group}<span>⌫ back</span>{/if}
			<span class={primaryHeld ? "font-semibold opacity-100" : ""}
				>{searching ? `Clear search for ${primaryName} keys` : `Hold ${primaryName} + key`}</span
			>
		</span>
	</div>
</dialog>

<style>
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(2px);
	}
</style>
