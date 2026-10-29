<script>
	// The Ledger toolbar's Types button and menu. It edits the project's
	// content-type exclusion through the Ledger store: group chips (major/*
	// for a whole major type), a find box that can add an unseen type or
	// major/*, and Shown and Hidden lists with pair counts from
	// CountContentTypes, reloaded each time the menu opens. "Reset to
	// default" drops the project's own list so it follows the app default,
	// which Settings edits.
	import { onMount, tick } from "svelte";
	import { ChevronDown, FileType, Plus, Search } from "lucide-svelte";
	import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { primaryVariant } from "../launchpad/format.js";
	import { ledgerStore } from "../../stores/ledgerStore";
	import { select } from "../storeSelect.js";
	import {
		CONTENT_TYPE_GROUPS,
		groupState,
		toggleGroup,
		toggleType,
		typeLabel,
		typeLists,
	} from "./contentTypes.js";

	const modalStore = getModalStore();
	const exclusion = select(ledgerStore, (state) => state.exclusion);
	const ownExclusion = select(ledgerStore, (state) => state.ownExclusion);
	const typeCounts = select(ledgerStore, (state) => state.typeCounts);

	let open = false;
	let find = "";
	let findBox;
	let root;
	let idleOpen = false;

	$: primary = primaryVariant($modeCurrent);
	$: lists = typeLists($typeCounts.counts, $exclusion, find);
	// The badge counts hidden types with traffic: the default exclusion holds
	// many types that never appear.
	$: hiddenWithTraffic = $typeCounts.loaded ? typeLists($typeCounts.counts, $exclusion).hidden.length : 0;

	// The counts never hold up the table: they load once for the badge, and
	// again on each open since traffic keeps arriving. Visiting the page
	// again doesn't reread them.
	onMount(() => {
		if (!$typeCounts.loaded) ledgerStore.loadTypeCounts();
	});

	function setOpen(next) {
		open = next;
		if (open) ledgerStore.loadTypeCounts();
		else find = "";
	}

	/** Opens the menu with its find box focused, or closes it if the box already has focus. */
	export async function focusFind() {
		if (open && document.activeElement === findBox) {
			setOpen(false);
			return;
		}
		if (!open) setOpen(true);
		await tick();
		findBox?.focus();
	}

	function change(next) {
		ledgerStore.saveExclusion(next).catch((err) => console.error("Saving the content-type exclusion failed:", err));
	}

	function addFound() {
		if (!lists.addable) return;
		change([...$exclusion, lists.addable]);
		find = "";
	}

	function confirmReset() {
		modalStore.trigger({
			type: "confirm",
			title: "Reset to the app default?",
			body: "This project drops its own list of hidden content types and follows the app default from Settings.",
			response: (ok) => {
				if (!ok) return;
				ledgerStore
					.resetExclusion()
					.catch((err) => console.error("Resetting the content-type exclusion failed:", err));
			},
		});
	}

	function onWindowPointerDown(e) {
		if (open && root && !root.contains(e.target)) setOpen(false);
	}

	function onKeydown(e) {
		if (e.key === "Escape" && open) {
			e.preventDefault();
			e.stopPropagation();
			setOpen(false);
		}
	}

	function chipTitle(group, state) {
		if (state === "partial") return `Partly hidden; click to show all of ${group.types.join(", ")}`;
		return `${state === "shown" ? "Hide" : "Show"} ${group.types.join(", ")}`;
	}
</script>

<!-- Escape closes the open menu wherever focus is, before other handlers see it. -->
<svelte:window on:pointerdown={onWindowPointerDown} on:keydown|capture={onKeydown} />

<div class="ledger-types relative flex items-stretch border-l border-surface-300-600-token" bind:this={root}>
	<button
		id="ledgerTypesButton"
		type="button"
		class="flex items-center gap-1.5 px-3 text-sm hover:bg-surface-200-700-token {open
			? 'bg-surface-200-700-token'
			: ''}"
		title="Content types the Ledger hides"
		aria-expanded={open}
		aria-controls="ledgerTypesMenu"
		on:click={() => setOpen(!open)}
	>
		<FileType size={15} class="opacity-70" />
		Types
		{#if hiddenWithTraffic}
			<span
				id="ledgerTypesHiddenCount"
				class="badge {primary} px-1.5 py-0 text-3xs"
				title="{$exclusion.length} content-type values hidden in total">{hiddenWithTraffic} hidden</span
			>
		{/if}
	</button>

	{#if open}
		<div
			id="ledgerTypesMenu"
			class="absolute right-0 top-full z-40 flex max-h-[70vh] w-[26rem] flex-col border border-surface-300-600-token bg-surface-100-800-token text-sm shadow-xl"
			role="dialog"
			aria-label="Content types"
		>
			<div class="flex flex-col gap-2 border-b border-primary-500 p-2">
				<div class="input-group input-group-divider grid-cols-[auto_minmax(0,1fr)] rounded-none">
					<div class="input-group-shim"><Search size={14} /></div>
					<input
						id="ledgerTypesFind"
						bind:this={findBox}
						bind:value={find}
						on:keydown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								addFound();
							}
						}}
						class="min-w-0 font-mono text-xs"
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder="Find or hide a type, or major/*…"
					/>
				</div>
				<div class="flex flex-wrap gap-1">
					{#each CONTENT_TYPE_GROUPS as group (group.label)}
						{@const state = groupState(group, $exclusion)}
						<button
							type="button"
							class="ledger-types-group btn btn-sm rounded-none px-2 py-1 text-xs shadow-none {state === 'shown'
								? primary
								: 'variant-soft'}"
							data-state={state}
							aria-pressed={state === "shown"}
							title={chipTitle(group, state)}
							on:click={() => change(toggleGroup(group, $exclusion))}>{group.label}</button
						>
					{/each}
				</div>
				<div class="flex items-center justify-between text-xs">
					<span id="ledgerTypesSource" class="opacity-70">
						{#if $ownExclusion}
							This project's own list
						{:else if $ownExclusion === false}
							Following the app default
						{/if}
					</span>
					{#if $ownExclusion}
						<button id="ledgerTypesReset" type="button" class="hover:underline" on:click={confirmReset}
							>Reset to default</button
						>
					{/if}
				</div>
			</div>

			<div class="overflow-auto pb-1">
				{#if lists.addable}
					<button
						id="ledgerTypesAdd"
						type="button"
						class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-200-700-token"
						on:click={addFound}
						><Plus size={14} /> Hide <span class="font-mono">{lists.addable}</span></button
					>
				{/if}

				<div
					class="sticky top-0 flex justify-between bg-surface-100-800-token px-3 pb-1 pt-2 text-xs uppercase tracking-wide opacity-70"
				>
					<span>Shown ({lists.shown.length})</span>
				</div>
				{#each lists.shown as entry (entry.contentType)}
					<label
						class="ledger-types-row flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-surface-200-700-token"
						data-type={entry.contentType}
					>
						<!-- Pairs with no response are never hidden. -->
						<input
							type="checkbox"
							class="checkbox"
							checked
							disabled={entry.contentType === ""}
							title={entry.contentType === "" ? "Pairs with no response are always shown" : ""}
							on:change={() => change(toggleType(entry.contentType, $exclusion))}
						/>
						<span
							class="min-w-0 flex-1 truncate text-xs {entry.contentType === '' ? 'italic opacity-70' : 'font-mono'}"
							>{typeLabel(entry.contentType)}</span
						>
						<span class="text-3xs opacity-60">{entry.group ?? ""}</span>
						<span class="w-12 text-right text-xs tabular-nums">{entry.count.toLocaleString()}</span>
					</label>
				{:else}
					<p class="px-3 py-1 text-xs opacity-60">No shown types match.</p>
				{/each}

				<div
					class="sticky top-0 flex justify-between bg-surface-100-800-token px-3 pb-1 pt-2 text-xs uppercase tracking-wide opacity-70"
				>
					<span>Hidden ({lists.hidden.length})</span>
					{#if $exclusion.length}
						<button
							type="button"
							class="normal-case tracking-normal hover:underline"
							on:click={() => change([])}>Show all</button
						>
					{/if}
				</div>
				{#each lists.hidden as entry (entry.contentType)}
					{@const byMajor = entry.hiddenBy !== entry.contentType}
					<label
						class="ledger-types-row flex cursor-pointer items-center gap-2 px-3 py-1 opacity-70 hover:bg-surface-200-700-token hover:opacity-100"
						data-type={entry.contentType}
					>
						<input
							type="checkbox"
							class="checkbox"
							disabled={byMajor}
							title={byMajor ? `Hidden by ${entry.hiddenBy}` : ""}
							on:change={() => change(toggleType(entry.contentType, $exclusion))}
						/>
						<span class="min-w-0 flex-1 truncate font-mono text-xs">{entry.contentType}</span>
						<span class="text-3xs opacity-60">{byMajor ? entry.hiddenBy : (entry.group ?? "")}</span>
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
							>{lists.idle.length} more hidden {lists.idle.length === 1 ? "value" : "values"} with no
							traffic yet</span
						>
						<span class="text-primary-500 {idleOpen ? 'rotate-180' : ''}"><ChevronDown size={14} /></span>
					</button>
					{#if idleOpen}
						{#each lists.idle as entry (entry.contentType)}
							<label
								class="ledger-types-row flex cursor-pointer items-center gap-2 px-3 py-0.5 opacity-60 hover:bg-surface-200-700-token hover:opacity-100"
								data-type={entry.contentType}
							>
								<input
									type="checkbox"
									class="checkbox"
									on:change={() => change($exclusion.filter((t) => t !== entry.contentType))}
								/>
								<span class="min-w-0 flex-1 truncate font-mono text-xs">{entry.contentType}</span>
								<span class="text-3xs opacity-60">{entry.group ?? "custom"}</span>
							</label>
						{/each}
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>
