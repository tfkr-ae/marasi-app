<script>
	// Two columns styled like Marasi menu items: pages (with the app rail's
	// icons; an extension page shows the icon the extension rendered), then
	// the selected page's states. Selecting a page selects its first state.
	import {
		Book,
		BookOpenCheck,
		Compass,
		Flag,
		Globe,
		Puzzle,
		Radio,
		Send,
		Swords,
		Wrench,
	} from "lucide-svelte";
	import { extensions, extensions_ui } from "../../../stores.js";
	import ExtensionUI from "../../extensions/ExtensionUI.svelte";
	import { pagesOf } from "../../keybindings/settings.js";
	import CountSlot from "./CountSlot.svelte";

	export let groups; // browse() groups
	export let selected; // group id
	export let onSelect; // (groupId) => void

	const icons = {
		Global: Globe,
		Extensions: Puzzle,
		WebSocket: Radio,
		Ledger: Book,
		Armory: Swords,
		Launchpad: Send,
		Checkpoint: Flag,
		Logbook: BookOpenCheck,
		Compass,
		Workshop: Wrench,
	};

	$: pages = pagesOf(groups);

	// The loaded extension behind an extension page entry, with its icon.
	function extensionIcon(page, loaded, ui) {
		if (!page.groups[0].id.startsWith("extension-page.")) return null;
		const extension = loaded.find((candidate) => candidate.Name === page.page);
		const icon = extension && ui[extension.Name]?.icon;
		return icon ? { extension, schema: { ...icon, size: 16 } } : null;
	}
	$: current = pages.find((page) => page.groups.some((group) => group.id === selected));

	const entry =
		"flex w-full items-center justify-between gap-2 border-l-4 px-3 py-2 text-left hover:bg-surface-200 dark:hover:bg-surface-700 focus:!outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500";
	const active = (on) => (on ? "border-primary-500 bg-surface-200 dark:bg-surface-700" : "border-transparent");
</script>

<nav
	class="kb-nav w-48 shrink-0 overflow-y-auto [scrollbar-gutter:stable] border-r border-surface-300 dark:border-surface-600"
	aria-label="Page"
>
	{#each pages as page (page.page)}
		{@const own = extensionIcon(page, $extensions, $extensions_ui)}
		<button
			type="button"
			class="{entry} {active(page === current)}"
			aria-current={page === current ? "true" : undefined}
			on:click={() => onSelect(page.groups[0].id)}
		>
			<span class="flex min-w-0 items-center gap-2">
				{#if own}
					<span class="flex shrink-0 opacity-80"><ExtensionUI extensionData={own.extension} schema={own.schema} /></span>
				{:else}
					<svelte:component this={icons[page.page] ?? Puzzle} size={16} class="shrink-0 opacity-80" />
				{/if}
				<span class="truncate">{page.page}</span>
			</span>
			<CountSlot counts={page} />
		</button>
	{/each}
</nav>

<nav
	class="kb-nav w-48 shrink-0 overflow-y-auto [scrollbar-gutter:stable] border-r border-surface-300 dark:border-surface-600"
	aria-label="State"
>
	{#each current?.groups ?? [] as group (group.id)}
		<button
			type="button"
			class="{entry} {active(selected === group.id)}"
			aria-current={selected === group.id ? "true" : undefined}
			on:click={() => onSelect(group.id)}
		>
			<span class="min-w-0">{group.state}</span>
			<CountSlot counts={group} />
		</button>
	{/each}
</nav>
