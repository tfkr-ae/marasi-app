<script context="module">
	// The dock's width and which templates are expanded survive page visits
	// within a session; a project switch clears the expansion.
	let savedWidth;
	let savedExpanded = { version: null, ids: new Set() };
</script>

<script>
	// The Armory dock: a filter box and the templates as a tree, each
	// expanding into its runs with their status. Clicking a template selects
	// it; clicking a run selects its template and the run.
	import { writable } from "svelte/store";
	import {
		ChevronDown,
		ChevronRight,
		CircleStop,
		FileText,
		Plus,
		RefreshCw,
		Rocket,
		Search,
		Trash2,
	} from "lucide-svelte";
	import Dock from "../dock/Dock.svelte";
	import { ARMORY_DOCK } from "../dock/dock.js";
	import RunStatus from "./RunStatus.svelte";

	/** The templates that match the filter. */
	export let templates = [];
	export let runsByTemplate = {};
	export let selectedTemplateId = null;
	export let selectedRunId = null;
	export let search = "";
	/** Changes on a project switch, which collapses every template. */
	export let projectStateVersion = 0;
	export let onSelectTemplate = (template) => {};
	export let onSelectRun = (template, run) => {};
	/** A template opened whose runs have not loaded yet. */
	export let onExpand = (template) => {};
	export let onCreate = () => {};
	export let onRefresh = () => {};
	export let onStartRun = (run) => {};
	export let onCancelRun = (run) => {};
	export let onDeleteRun = (run) => {};

	const dockState = writable({ width: savedWidth ?? ARMORY_DOCK.default, collapsed: false });
	$: savedWidth = $dockState.width;

	let searchInput;
	let expanded = savedExpanded.version === projectStateVersion ? savedExpanded.ids : new Set();
	let expandedVersion = projectStateVersion;
	$: if (projectStateVersion !== expandedVersion) {
		expandedVersion = projectStateVersion;
		expanded = new Set();
	}
	$: savedExpanded = { version: expandedVersion, ids: expanded };

	// The selected template opens once when it is selected; it can then be
	// closed.
	let openedFor = selectedTemplateId;
	$: if (selectedTemplateId !== openedFor) {
		openedFor = selectedTemplateId;
		if (selectedTemplateId && !expanded.has(selectedTemplateId)) {
			expanded = new Set(expanded).add(selectedTemplateId);
		}
	}

	$: query = search.trim();

	function toggle(template) {
		const next = new Set(expanded);
		if (next.has(template.ID)) next.delete(template.ID);
		else {
			next.add(template.ID);
			if (!runsByTemplate[template.ID]) onExpand(template);
		}
		expanded = next;
	}

	// Keeps the selected row in view as the shortcuts move it.
	function reveal(node, active) {
		const show = (on) => on && node.scrollIntoView({ block: "nearest" });
		show(active);
		return { update: show };
	}
</script>

<Dock
	state={dockState}
	limits={ARMORY_DOCK}
	stripLabel="Templates"
	expandLabel="Show templates"
	searchLabel="Search templates"
	{searchInput}
>
	<svelte:fragment slot="header">
		<span class="mr-auto px-1 text-xs font-bold"
			>Templates <span class="text-[10px] font-normal opacity-70">{templates.length}</span></span
		>
		<button
			class="opacity-70 hover:opacity-100 disabled:opacity-30"
			title="Refresh runs"
			aria-label="Refresh runs"
			disabled={!selectedTemplateId}
			on:click={onRefresh}
		>
			<RefreshCw size={12} />
		</button>
		<button class="opacity-70 hover:opacity-100" title="New template" aria-label="Create template" on:click={onCreate}>
			<Plus size={13} />
		</button>
	</svelte:fragment>

	<div class="flex h-full min-h-0 flex-col">
		<div class="border-b border-surface-500/30 p-2">
			<div class="input-group input-group-divider grid h-8 grid-cols-[auto_1fr]">
				<div class="input-group-shim"><Search size={13} /></div>
				<input
					bind:this={searchInput}
					type="search"
					class="text-xs"
					placeholder="Search templates…"
					bind:value={search}
				/>
			</div>
		</div>
		<div class="min-h-0 flex-1 overflow-auto" role="tree" aria-label="Templates">
			{#if templates.length === 0}
				<p class="p-4 text-center text-xs opacity-60">
					{query ? "No matching templates" : "No templates yet"}
				</p>
			{/if}
			{#each templates as template (template.ID)}
				{@const open = expanded.has(template.ID)}
				{@const runs = runsByTemplate[template.ID]}
				{@const selected = template.ID === selectedTemplateId}
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-interactive-supports-focus -->
				<div
					role="treeitem"
					aria-selected={selected}
					aria-expanded={open}
					aria-current={selected}
					class="relative flex cursor-default select-none items-center gap-1.5 border-b border-surface-500/20 px-2 py-1.5 text-[11px] {selected
						? 'bg-primary-500/10'
						: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
					title={template.Description || template.Name}
					use:reveal={selected}
					on:click={() => onSelectTemplate(template)}
					on:dblclick={() => toggle(template)}
				>
					<button
						class="flex-none opacity-70 hover:opacity-100"
						aria-label={open ? "Collapse" : "Expand"}
						on:click|stopPropagation={() => toggle(template)}
						on:dblclick|stopPropagation
					>
						{#if open}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
					</button>
					<FileText size={12} class="flex-none opacity-60" />
					<span class="min-w-0 flex-1 truncate font-semibold">{template.Name}</span>
					{#if runs}<span class="flex-none text-[10px] opacity-60">{runs.length}</span>{/if}
				</div>
				{#if open}
					<div class="relative" role="group">
						<span class="absolute bottom-0 left-[13px] top-0 w-px bg-surface-500/30"></span>
						{#if runs && runs.length === 0}
							<p class="py-1 pl-7 text-[10px] opacity-50">No runs</p>
						{/if}
						{#each runs ?? [] as run (run.ID)}
							{@const current = selected && run.ID === selectedRunId}
							<!-- svelte-ignore a11y-click-events-have-key-events a11y-interactive-supports-focus -->
							<div
								role="treeitem"
								aria-selected={current}
								aria-current={current}
								class="group relative flex cursor-default select-none items-center gap-2 py-[3px] pl-7 pr-2 font-mono text-[11px] {current
									? 'bg-primary-500/20'
									: 'hover:bg-surface-200/70 dark:hover:bg-surface-700/60'}"
								title="{run.MaxConcurrent} workers · {new Date(run.CreatedAt).toLocaleString()}"
								use:reveal={current}
								on:click={() => onSelectRun(template, run)}
							>
								{#if current}<span class="absolute bottom-0 left-0 top-0 w-[3px] bg-primary-500"></span>{/if}
								<span class="min-w-0 flex-1 truncate capitalize">{run.AttackType}</span>
								<span class="flex-none items-center gap-1.5 {current ? 'flex' : 'hidden group-hover:flex'}">
									{#if run.Status === "draft"}
										<button
											class="opacity-70 hover:opacity-100"
											title="Start run"
											aria-label="Start run"
											on:click|stopPropagation={() => onStartRun(run)}><Rocket size={12} /></button
										>
									{:else if run.Status === "in_progress"}
										<button
											class="opacity-70 hover:opacity-100"
											title="Cancel run"
											aria-label="Cancel run"
											on:click|stopPropagation={() => onCancelRun(run)}><CircleStop size={12} /></button
										>
									{/if}
									{#if run.Status !== "in_progress"}
										<button
											class="opacity-70 hover:opacity-100"
											title="Delete run"
											aria-label="Delete run"
											on:click|stopPropagation={() => onDeleteRun(run)}><Trash2 size={12} /></button
										>
									{/if}
								</span>
								<RunStatus status={run.Status} />
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		</div>
	</div>
</Dock>
