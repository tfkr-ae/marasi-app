<script>
	// The Highlights menu's panel: "Any highlight", then the 8 highlights,
	// each with its swatch, label, scope tag and match count. Choosing a row
	// dispatches `toggle` with its query term. The pencil, or a double-click,
	// renames a label inline: dispatches `rename` with { number, label,
	// allProjects }. Colours are set in Settings → Highlights.
	import { createEventDispatcher, onDestroy, tick } from "svelte";
	import { Check, Pencil, X } from "lucide-svelte";
	import { hasQueryTerm } from "../ledgerQueryFields.js";
	import { matchCountText } from "./counts.js";
	import { ANY_HIGHLIGHT_TERM, highlightTerm } from "./highlights.js";

	/** The text in the query box. */
	export let queryText = "";
	/** { [term]: { count, capped } | null }; a missing term is still loading. */
	export let counts = {};
	/** The effective highlight palette (stores/highlightsStore.js). */
	export let palette = [];

	const dispatch = createEventDispatcher();

	// The highlight being renamed, its draft label and scope.
	let editing = null;
	let draft = "";
	let allProjects = false;
	let input;

	async function startRename(h) {
		editing = h.number;
		draft = h.label;
		allProjects = h.scope === "app";
		await tick();
		input?.select();
	}

	function commit() {
		dispatch("rename", { number: editing, label: draft, allProjects });
		editing = null;
	}

	function onEditKeydown(event) {
		if (event.key === "Escape") {
			event.stopPropagation();
			editing = null;
		}
	}

	// A click on a highlight toggles it once it is clear no second click
	// follows, so a double-click renames without toggling (and running the
	// query) twice. A key press (detail 0) toggles at once.
	const DOUBLE_CLICK_MS = 250;
	let clickTimer = null;
	function onHighlightClick(event, term) {
		clearTimeout(clickTimer);
		if (event.detail === 0) dispatch("toggle", term);
		else if (event.detail === 1) clickTimer = setTimeout(() => dispatch("toggle", term), DOUBLE_CLICK_MS);
	}
	function onHighlightDblClick(h) {
		clearTimeout(clickTimer);
		startRename(h);
	}
	onDestroy(() => clearTimeout(clickTimer));

	const rowClass = (active) =>
		active ? "border-primary-500 bg-primary-500/20" : "border-transparent hover:bg-surface-200-700-token";
	const SCOPE_TITLE = { project: "Label set for this project", app: "Label set for all projects" };
</script>

<div class="py-1 text-xs" role="menu">
	{#each [ANY_HIGHLIGHT_TERM] as term}
		{@const active = hasQueryTerm(queryText, term)}
		<button
			type="button"
			class="ledger-highlight flex w-full items-center gap-2 border-l-4 py-1 pl-2 pr-3 {rowClass(active)}"
			role="menuitemcheckbox"
			aria-checked={active}
			data-term={term}
			title={term}
			on:click={() => dispatch("toggle", term)}
		>
			<span class="flex h-3 w-3 flex-none overflow-hidden rounded-full">
				{#each palette.slice(0, 4) as h}<span class="h-full flex-1" style="background: {h.color}"></span>{/each}
			</span>
			<span class="flex-1 text-left">Any highlight</span>
			<span class="ledger-highlight-count min-w-[3rem] text-right tabular-nums opacity-60"
				>{matchCountText(counts[term])}</span
			>
		</button>
	{/each}
	{#each palette as h (h.number)}
		{@const term = highlightTerm(h.number)}
		{@const active = hasQueryTerm(queryText, term)}
		{#if editing === h.number}
			<form
				class="ledger-highlight-rename space-y-1 border-l-4 border-primary-500 bg-primary-500/10 py-1.5 pl-2 pr-3"
				on:submit|preventDefault={commit}
			>
				<div class="flex items-center gap-2">
					<span class="h-3 w-3 flex-none rounded-full" style="background: {h.color}"></span>
					<input
						bind:this={input}
						bind:value={draft}
						class="input h-6 min-w-0 flex-1 rounded-none px-1 text-xs"
						aria-label="Label for highlight {h.number}"
						placeholder={h.name}
						on:keydown={onEditKeydown}
					/>
					<button type="submit" class="opacity-70 hover:opacity-100" title="Save" aria-label="Save"
						><Check size={13} /></button
					>
					<button
						type="button"
						class="opacity-70 hover:opacity-100"
						title="Cancel"
						aria-label="Cancel"
						on:click={() => (editing = null)}><X size={13} /></button
					>
				</div>
				<label class="flex items-center gap-1.5 pl-5 text-2xs opacity-80">
					<input type="checkbox" class="checkbox h-3 w-3" bind:checked={allProjects} /> Use in all projects
				</label>
			</form>
		{:else}
			<div
				class="ledger-highlight group flex items-center gap-2 border-l-4 pl-2 pr-3 {rowClass(active)}"
				data-term={term}
			>
				<button
					type="button"
					class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
					role="menuitemcheckbox"
					aria-checked={active}
					title={term}
					on:click={(event) => onHighlightClick(event, term)}
					on:dblclick={() => onHighlightDblClick(h)}
				>
					<span class="h-3 w-3 flex-none rounded-full" style="background: {h.color}"></span>
					<span class="min-w-0 flex-1 truncate">{h.label}</span>
					{#if h.scope}
						<span class="flex-none text-3xs uppercase opacity-50" title={SCOPE_TITLE[h.scope]}>{h.scope}</span>
					{/if}
				</button>
				<button
					type="button"
					class="ledger-highlight-rename-button flex-none opacity-0 hover:!opacity-100 focus:opacity-100 group-hover:opacity-60"
					title="Rename"
					aria-label="Rename {h.label}"
					on:click={() => startRename(h)}><Pencil size={11} /></button
				>
				<span class="ledger-highlight-count min-w-[3rem] text-right tabular-nums opacity-60"
					>{matchCountText(counts[term])}</span
				>
			</div>
		{/if}
	{/each}
</div>
