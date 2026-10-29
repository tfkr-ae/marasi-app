<script>
	// The Ledger toolbar's Saved queries menu: a ToolbarMenu, badged with
	// the active saved query's name, that opens the saved queries grouped by
	// source. Choosing a row applies its query, or clears it when it is the
	// active one ("apply" with the new query text). Counts load after the
	// menu opens.
	import { createEventDispatcher, onMount } from "svelte";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { Bookmark, BookmarkPlus, Check, Eye, EyeOff, Folder, Globe, Package, Pencil, Trash2 } from "lucide-svelte";
	import { primaryVariant } from "../launchpad/format.js";
	import ToolbarMenu from "./ToolbarMenu.svelte";
	import { matchCountText } from "./counts.js";
	import { toastError } from "../toasts.js";
	import {
		activeSavedQuery,
		canSaveQuery,
		hiddenBuiltinCount,
		savedQueriesStore,
		savedQueryGroups,
	} from "../../stores/savedQueriesStore";

	/** The query box's text. */
	export let queryText = "";
	/** True when queryText is a query Marasi accepted. */
	export let valid = false;

	const dispatch = createEventDispatcher();
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const GROUP_ICONS = { project: Folder, app: Globe, builtin: Package };

	let open = false;
	let saving = false;
	let name = "";
	let keepForAll = false;
	let editing = null;
	let editName = "";
	let showHidden = false;

	$: primary = primaryVariant($modeCurrent);
	$: active = activeSavedQuery($savedQueriesStore, queryText);
	$: canSave = canSaveQuery($savedQueriesStore, queryText, valid);
	$: groups = savedQueryGroups($savedQueriesStore, { showHidden });
	$: hiddenCount = hiddenBuiltinCount($savedQueriesStore);
	$: if (!canSave) saving = false;

	onMount(() => savedQueriesStore.load());

	function onOpen() {
		saving = false;
		editing = null;
		savedQueriesStore.loadCounts();
	}

	const failed = (action, error) => toastError(toastStore, `Failed to ${action}`, error);

	function choose(q) {
		dispatch("apply", active?.id === q.id ? "" : q.query);
		open = false;
	}

	function startSaving() {
		saving = true;
		name = "";
		keepForAll = false;
	}

	async function save() {
		try {
			await savedQueriesStore.save(name, queryText, keepForAll ? "app" : "project");
			saving = false;
			savedQueriesStore.loadCounts();
		} catch (error) {
			failed("save the query", error);
		}
	}

	function startRename(q) {
		editing = q.id;
		editName = q.name;
	}

	async function rename(q) {
		try {
			await savedQueriesStore.rename(q, editName);
			editing = null;
		} catch (error) {
			failed("rename the query", error);
		}
	}

	function remove(q) {
		modalStore.trigger({
			type: "confirm",
			title: "Delete saved query",
			body:
				q.source === "project"
					? `Delete "${q.name}" from this project?`
					: `Delete "${q.name}"? Every project loses it.`,
			response: (ok) => ok && savedQueriesStore.remove(q).catch((error) => failed("delete the query", error)),
		});
	}

	function move(q) {
		savedQueriesStore
			.move(q, q.source === "project" ? "app" : "project")
			.catch((error) => failed("move the query", error));
	}

	function setHidden(q, hidden) {
		savedQueriesStore.setBuiltinHidden(q.id, hidden).catch((error) => failed("update the built-ins", error));
	}

	function onEditKeydown(event, onEnter, onEscape) {
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			onEnter();
		} else if (event.key === "Escape") onEscape();
	}
</script>

<ToolbarMenu
	id="ledgerSavedQueries"
	label="Saved queries"
	icon={Bookmark}
	title={active ? `Saved query: ${active.name}` : "Saved queries"}
	badge={active?.name ?? ""}
	panelClass="w-80"
	stayOpen={Boolean($modalStore[0])}
	bind:open
	on:open={onOpen}
>
	<div class="ledger-saved-queries text-sm">
		<div class="border-b border-surface-500/30 p-3">
			{#if saving}
				<form class="space-y-1.5" on:submit|preventDefault={save}>
					<!-- svelte-ignore a11y-autofocus -->
					<input
						id="ledgerSavedQueryName"
						class="input h-8 text-xs"
						placeholder="Name"
						aria-label="Saved query name"
						bind:value={name}
						autofocus
						on:keydown|stopPropagation={(e) => e.key === "Escape" && (saving = false)}
					/>
					<div class="truncate font-mono text-3xs opacity-60" title={queryText}>{queryText.trim()}</div>
					<label class="flex cursor-pointer items-center gap-2 text-xs">
						<input id="ledgerSavedQueryKeepForAll" type="checkbox" class="checkbox" bind:checked={keepForAll} />
						Keep for all projects
					</label>
					<div class="flex items-center justify-end gap-2 text-xs">
						<button type="button" class="btn btn-sm variant-soft py-0.5" on:click={() => (saving = false)}
							>Cancel</button
						>
						<button type="submit" class="btn btn-sm {primary} py-0.5">Save</button>
					</div>
				</form>
			{:else}
				<button
					id="ledgerSaveQuery"
					type="button"
					class="btn btn-sm variant-soft w-full justify-start gap-2 text-xs"
					disabled={!canSave}
					title={canSave ? "Save the query in the box" : "Run a new, valid query first"}
					on:click={startSaving}
				>
					<BookmarkPlus size={14} /> Save current query
				</button>
			{/if}
		</div>
		<div class="pb-2 text-xs">
			{#each groups as group (group.key)}
				<div
					class="sticky top-0 z-10 flex items-center gap-1.5 bg-surface-100-800-token px-3 pb-1 pt-2 text-3xs uppercase tracking-wide opacity-70"
				>
					<svelte:component this={GROUP_ICONS[group.key]} size={11} />{group.label}
				</div>
				{#each group.items as q (q.id)}
					{@const isActive = active?.id === q.id}
					<div
						class="ledger-saved-query group flex items-center gap-2 border-l-4 py-[3px] pl-2 pr-3 {isActive
							? 'border-primary-500 bg-primary-500/20'
							: 'border-transparent hover:bg-surface-200-700-token'} {q.hidden ? 'opacity-50' : ''}"
					>
						<Bookmark size={12} class="flex-none {isActive ? 'text-primary-500' : 'opacity-50'}" />
						{#if editing === q.id}
							<!-- svelte-ignore a11y-autofocus -->
							<input
								class="input h-6 min-w-0 flex-1 px-1 text-xs"
								aria-label="New name"
								bind:value={editName}
								autofocus
								on:keydown={(e) => onEditKeydown(e, () => rename(q), () => (editing = null))}
							/>
							<button type="button" class="opacity-70 hover:opacity-100" title="Rename" on:click={() => rename(q)}
								><Check size={12} /></button
							>
						{:else}
							{@const count = $savedQueriesStore.counts[q.query]}
							<button
								type="button"
								class="min-w-0 flex-1 truncate text-left"
								title={isActive ? `${q.query}\n(choose again to clear)` : q.query}
								on:click={() => choose(q)}>{q.name}</button
							>
							<span
								class="flex-none tabular-nums opacity-60 group-hover:hidden"
								title={count?.error ?? ""}>{matchCountText(count)}</span
							>
							<span class="hidden flex-none items-center gap-1.5 group-hover:flex">
								{#if q.source === "builtin"}
									<button
										type="button"
										class="opacity-60 hover:opacity-100"
										title={q.hidden ? "Show this built-in" : "Hide this built-in"}
										aria-label={q.hidden ? `Show ${q.name}` : `Hide ${q.name}`}
										on:click={() => setHidden(q, !q.hidden)}
									>
										{#if q.hidden}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
									</button>
								{:else}
									<button
										type="button"
										class="opacity-60 hover:opacity-100"
										title="Rename"
										aria-label={`Rename ${q.name}`}
										on:click={() => startRename(q)}><Pencil size={12} /></button
									>
									{#if q.source === "app"}
										<button
											type="button"
											class="opacity-60 hover:opacity-100"
											title="Move to this project only"
											aria-label={`Move ${q.name} to this project`}
											on:click={() => move(q)}><Folder size={12} /></button
										>
									{:else}
										<button
											type="button"
											class="opacity-60 hover:opacity-100"
											title="Keep for all projects"
											aria-label={`Move ${q.name} to all projects`}
											on:click={() => move(q)}><Globe size={12} /></button
										>
									{/if}
									<button
										type="button"
										class="opacity-60 hover:text-error-500 hover:opacity-100"
										title="Delete"
										aria-label={`Delete ${q.name}`}
										on:click={() => remove(q)}><Trash2 size={12} /></button
									>
								{/if}
							</span>
						{/if}
					</div>
				{/each}
			{/each}
			{#if hiddenCount}
				<button
					id="ledgerShowHiddenBuiltins"
					type="button"
					class="px-3 pt-2 text-2xs text-primary-500 hover:underline"
					on:click={() => (showHidden = !showHidden)}
				>
					{showHidden ? "Hide" : "Show"}
					{hiddenCount} hidden built-in{hiddenCount === 1 ? "" : "s"}
				</button>
			{/if}
		</div>
	</div>
</ToolbarMenu>
