<script>
	// The Ledger toolbar's Types button and menu. It edits the content-type
	// exclusion (exact types) and reports each change through a "change"
	// event; the page stores it.
	import { createEventDispatcher, onMount, tick } from "svelte";
	import { FilterIcon, Search, Plus, ChevronDown, X } from "lucide-svelte";
	import { modeCurrent } from "@skeletonlabs/skeleton";
	import { CountContentTypes } from "../wailsjs/go/main/App";
	import {
		CONTENT_TYPE_GROUPS,
		DEFAULT_EXCLUSION,
		groupState,
		isDefaultExclusion,
		toggleGroup,
		toggleType,
		typeLists,
	} from "../ledgerContentTypes";

	export let excluded = [];
	export let open = false;
	export let primaryClass = "variant-filled-primary";

	const dispatch = createEventDispatcher();
	let counts = [];
	let find = "";
	let findBox;
	let root;
	let idleOpen = false;

	async function loadCounts() {
		try {
			counts = (await CountContentTypes()) ?? [];
		} catch (error) {
			console.error("counting content types:", error);
			counts = [];
		}
	}

	onMount(loadCounts);
	// Counts change as traffic arrives, so they are reloaded on every open.
	// The find box starts empty each time.
	$: if (open) loadCounts();
	$: if (!open) find = "";

	/** Opens or closes the menu. */
	export function toggle() {
		open = !open;
	}

	/** Opens the menu with its find box focused, or closes it if it already has focus. */
	export async function focusFind() {
		if (open && document.activeElement === findBox) {
			open = false;
			return;
		}
		open = true;
		await tick();
		findBox?.focus();
	}

	$: lists = typeLists(counts, excluded, find);
	// The badge counts hidden types that have traffic: the default exclusion
	// alone holds about 80 types, most of which never appear.
	$: hiddenWithTraffic = typeLists(counts, excluded).hidden.length;

	function change(next) {
		dispatch("change", next);
	}

	function addFound() {
		if (!lists.addable) return;
		change([...excluded, lists.addable]);
		find = "";
	}

	function onFindKeydown(e) {
		if (e.key === "Enter") {
			e.preventDefault();
			addFound();
		}
	}

	function onWindowPointerDown(e) {
		if (open && root && !root.contains(e.target)) open = false;
	}

	function onKeydown(e) {
		if (e.key === "Escape" && open) {
			e.preventDefault();
			e.stopPropagation();
			open = false;
		}
	}

	// The dashboard's button pair: primary for shown groups, its plain
	// surface button for the rest. A partly hidden group is not fully shown,
	// so it looks hidden; its title says how much is hidden.
	$: surfaceClass = $modeCurrent
		? "variant-ghost border-0 ring-0"
		: "variant-filled";
	$: chipClass = {
		shown: primaryClass,
		partial: surfaceClass,
		hidden: surfaceClass,
	};
</script>

<!-- Escape closes the open menu wherever focus is, before other handlers see it. -->
<svelte:window
	on:pointerdown={onWindowPointerDown}
	on:keydown|capture={onKeydown}
/>

<div class="relative h-full" bind:this={root}>
	<button
		id="ledgerTypesButton"
		type="button"
		class="flex h-full items-center gap-2 px-3 hover:bg-surface-200-700-token {open
			? 'bg-surface-200-700-token'
			: ''}"
		title="Content types"
		aria-expanded={open}
		aria-controls="ledgerTypesMenu"
		on:click={toggle}
	>
		<FilterIcon size={16} />
		<span class="text-sm">Types</span>
		{#if hiddenWithTraffic}
			<span
				id="ledgerTypesHiddenCount"
				class="badge {primaryClass} px-1.5 py-0.5 text-xs"
				title="{excluded.length} content types excluded in total"
				>{hiddenWithTraffic} hidden</span
			>
		{/if}
	</button>

	{#if open}
		<div
			id="ledgerTypesMenu"
			class="absolute right-0 top-full z-30 flex max-h-[70vh] w-[26rem] flex-col rounded-none border border-surface-300-600-token bg-surface-100-800-token text-sm shadow-xl"
			role="dialog"
			aria-label="Content types"
		>
			<div class="flex flex-col gap-2 border-b border-primary-500 p-2">
				<div
					class="input-group input-group-divider {find
						? 'grid-cols-[auto_minmax(0,1fr)_auto]'
						: 'grid-cols-[auto_minmax(0,1fr)]'}"
				>
					<div class="input-group-shim"><Search size={14} /></div>
					<input
						id="ledgerTypesFind"
						bind:this={findBox}
						bind:value={find}
						on:keydown={onFindKeydown}
						class="min-w-0 font-mono text-xs"
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder="Find or add a type…"
					/>
					{#if find}
						<button
							id="ledgerTypesFindClear"
							type="button"
							class="input-group-shim"
							title="Clear"
							aria-label="Clear the find box"
							on:click={() => {
								find = "";
								findBox?.focus();
							}}
						>
							<X size={14} />
						</button>
					{/if}
				</div>
				<div class="flex flex-wrap gap-1">
					{#each CONTENT_TYPE_GROUPS as group}
						{@const state = groupState(group, excluded)}
						<button
							type="button"
							class="btn btn-sm rounded-none px-2 py-1 text-xs shadow-none {chipClass[state]}"
							aria-pressed={state === "shown"}
							title={state === "partial"
								? `${group.types.filter((t) => excluded.includes(t)).length} of ${group.types.length} types hidden; click to show all`
								: `${state === "shown" ? "Hide" : "Show"} ${group.types.length} ${group.types.length === 1 ? "type" : "types"}`}
							on:click={() => change(toggleGroup(group, excluded))}
							>{group.label}</button
						>
					{/each}
				</div>
			</div>

			<div class="scrollbar-minimal overflow-auto pb-1">
				{#if lists.addable}
					<button
						type="button"
						class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-200-700-token"
						on:click={addFound}
						><Plus size={14} /> Hide
						<span class="font-mono">{lists.addable}</span></button
					>
				{/if}

				<div
					class="sticky top-0 flex justify-between bg-surface-100-800-token px-3 pb-1 pt-2 text-xs uppercase tracking-wide opacity-70"
				>
					<span>Shown ({lists.shown.length})</span>
					{#if !isDefaultExclusion(excluded)}
						<button
							type="button"
							class="normal-case tracking-normal hover:underline"
							on:click={() => change([...DEFAULT_EXCLUSION])}
							>Defaults</button
						>
					{/if}
				</div>
				{#each lists.shown as entry (entry.contentType)}
					<label
						class="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-surface-200-700-token"
					>
						<!-- Queries always show pairs awaiting a response, so "" can't be hidden. -->
						<input
							type="checkbox"
							class="checkbox"
							checked
							disabled={entry.contentType === ""}
							title={entry.contentType === ""
								? "Pairs awaiting a response are always shown"
								: ""}
							on:change={() =>
								change(toggleType(entry.contentType, excluded))}
						/>
						<span class="min-w-0 flex-1 truncate font-mono text-xs"
							>{entry.contentType || "(awaiting response)"}</span
						>
						<span class="text-[10px] opacity-60">{entry.group ?? ""}</span>
						<span class="w-12 text-right text-xs tabular-nums"
							>{entry.count.toLocaleString()}</span
						>
					</label>
				{:else}
					<p class="px-3 py-1 text-xs opacity-60">No shown types match.</p>
				{/each}

				<div
					class="sticky top-0 flex justify-between bg-surface-100-800-token px-3 pb-1 pt-2 text-xs uppercase tracking-wide opacity-70"
				>
					<span>Hidden ({lists.hidden.length})</span>
					{#if excluded.length}
						<button
							type="button"
							class="normal-case tracking-normal hover:underline"
							on:click={() => change([])}>Show all</button
						>
					{/if}
				</div>
				{#each lists.hidden as entry (entry.contentType)}
					<label
						class="flex cursor-pointer items-center gap-2 px-3 py-1 opacity-70 hover:bg-surface-200-700-token hover:opacity-100"
					>
						<input
							type="checkbox"
							class="checkbox"
							on:change={() =>
								change(toggleType(entry.contentType, excluded))}
						/>
						<span class="min-w-0 flex-1 truncate font-mono text-xs"
							>{entry.contentType || "(awaiting response)"}</span
						>
						<span class="text-[10px] opacity-60">{entry.group ?? ""}</span>
						<span
							class="w-12 text-right text-xs tabular-nums"
							title="Showing this type adds {entry.count.toLocaleString()} rows"
							>+{entry.count.toLocaleString()}</span
						>
					</label>
				{/each}

				{#if lists.idle.length}
					<button
						type="button"
						class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs opacity-70 hover:bg-surface-200-700-token hover:opacity-100"
						aria-expanded={idleOpen}
						on:click={() => (idleOpen = !idleOpen)}
					>
						<span
							>{lists.idle.length} more excluded {lists.idle.length ===
							1
								? "type"
								: "types"} with no traffic yet</span
						>
						<span class="text-primary-500 {idleOpen ? 'rotate-180' : ''}"
							><ChevronDown size={14} /></span
						>
					</button>
					{#if idleOpen}
						{#each lists.idle as entry (entry.contentType)}
							<label
								class="flex cursor-pointer items-center gap-2 px-3 py-0.5 opacity-60 hover:bg-surface-200-700-token hover:opacity-100"
							>
								<input
									type="checkbox"
									class="checkbox"
									on:change={() =>
										change(
											toggleType(entry.contentType, excluded),
										)}
								/>
								<span class="min-w-0 flex-1 truncate font-mono text-xs"
									>{entry.contentType}</span
								>
								<span class="text-[10px] opacity-60"
									>{entry.group ?? "custom"}</span
								>
							</label>
						{/each}
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>
