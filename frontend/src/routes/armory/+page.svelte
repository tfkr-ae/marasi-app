<script>
	import { onMount } from "svelte";
	import CodeMirror from "svelte-codemirror-editor";
	import { StreamLanguage } from "@codemirror/language";
	import { http } from "@codemirror/legacy-modes/mode/http";
	import { oneDark } from "@codemirror/theme-one-dark";
	import { githubLight } from "@uiw/codemirror-theme-github";
	import { vim } from "@replit/codemirror-vim";
	import { autocompletion } from "@codemirror/autocomplete";
	import {
		Accordion,
		AccordionItem,
		getDrawerStore,
		getModalStore,
		getToastStore,
		SlideToggle,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import {
		ArrowLeft,
		ArrowRight,
		CircleStop,
		Edit,
		FilePlus2,
		Plus,
		RefreshCw,
		Rocket,
		Save,
		Search,
		SquareArrowUpRight,
		ToggleLeft,
		Trash2,
		X,
	} from "lucide-svelte";
	import { SettingsIcon } from "svelte-feather-icons";
	import { page } from "$app/stores";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { armoryCompletionSource } from "../../lib/autocomplete/armory";
	import { armoryStore } from "../../stores/armoryStore";
	import {
		activeProject,
		appState,
		drawerHeight,
		lineWrap,
		marasiConfig,
		proxyItems,
	} from "../../stores";

	const drawerStore = getDrawerStore();
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const attackTypes = ["harpoon", "broadside", "tandem", "maelstrom"];
	const attackDescriptions = {
		harpoon: "Applies one payload set to each template input in turn.",
		broadside: "Applies the same payload to every template input.",
		tandem: "Advances multiple payload sets together.",
		maelstrom: "Generates every combination of the selected payload sets.",
	};

	let search = "";
	let selectedTemplateId = null;
	let selectedRunId = null;
	let name = "";
	let description = "";
	let rawTemplate = "";
	let attackType = "harpoon";
	let useHTTPS = true;
	let selectedWordlists = [];

	let maxConcurrent = 10;
	let saving = false;
	let launching = false;
	let validating = true;
	let validationError = "";
	let validationReady = false;
	let validationTimer;
	let validationRequest = 0;
	let accOpened = false;
	let drawerOpened = false;
	let menu;

	$: query = search.trim().toLowerCase();
	$: filteredTemplates = $armoryStore.templates.filter(
		(template) =>
			!query ||
			template.Name.toLowerCase().includes(query) ||
			(template.Description || "")
				.toLowerCase()
				.includes(query),
	);
	$: selectedTemplate = $armoryStore.templates.find(
		(template) => template.ID === selectedTemplateId,
	);
	$: runs = selectedTemplateId
		? $armoryStore.runsByTemplate[selectedTemplateId] || []
		: [];
	$: selectedRun = runs.find((run) => run.ID === selectedRunId);
	$: requests = selectedRun
		? ($proxyItems || []).filter(
				(item) =>
					String(item?.Metadata?.armory_run_id) ===
					String(selectedRunId),
			)
		: [];
	$: if (!selectedTemplateId && $armoryStore.templates.length > 0) {
		selectTemplate($armoryStore.templates[0]);
	}
	$: routeTemplateId = $page.url.searchParams.get("id");
	$: if (routeTemplateId && routeTemplateId !== selectedTemplateId) {
		const routeTemplate = $armoryStore.templates.find(
			(template) => template.ID === routeTemplateId,
		);
		if (routeTemplate) selectTemplate(routeTemplate);
	}
	$: if (validationReady) {
		queueValidation(
			selectedTemplateId,
			rawTemplate,
			attackType,
			selectedWordlists,
			Number(maxConcurrent),
		);
	}

	function queueValidation(
		templateId,
		template,
		type,
		wordlists,
		concurrent,
	) {
		clearTimeout(validationTimer);
		const request = ++validationRequest;
		validationError = "";
		validating = !!templateId;
		if (!templateId) return;

		validationTimer = setTimeout(async () => {
			try {
				await armoryStore.validateRun({
					rawTemplate: template,
					attackType: type,
					wordlists,
					maxConcurrent: concurrent,
				});
			} catch (error) {
				if (request === validationRequest)
					validationError = String(error);
			} finally {
				if (request === validationRequest) validating = false;
			}
		}, 300);
	}

	function notify(message, background = "variant-filled-success") {
		toastStore.trigger({ message, background });
	}

	function reportError(error) {
		notify(String(error), "variant-filled-error");
	}

	async function selectTemplate(template) {
		selectedTemplateId = template.ID;
		selectedRunId = null;
		name = template.Name;
		description = template.Description || "";
		rawTemplate = template.RawTemplate;
		try {
			await armoryStore.loadRuns(template.ID);
		} catch (error) {
			reportError(error);
		}
	}

	function createTemplate() {
		modalStore.trigger({
			type: "prompt",
			title: "New Armory Template",
			body: "Enter a name for the request template.",
			valueAttr: { placeholder: "Template name" },
			buttonTextSubmit: "Create",
			response: async (value) => {
				if (typeof value !== "string" || !value.trim()) return;
				try {
					const template =
						await armoryStore.createTemplate(
							{
								name: value.trim(),
								description: "",
								rawTemplate: "",
							},
						);
					await selectTemplate(template);
					notify("Template created");
				} catch (error) {
					reportError(error);
				}
			},
		});
	}

	async function saveTemplate() {
		if (!selectedTemplate) return false;
		saving = true;
		try {
			await armoryStore.updateTemplate(selectedTemplate.ID, {
				name,
				description,
				rawTemplate,
			});
			notify("Template saved");
			return true;
		} catch (error) {
			reportError(error);
			return false;
		} finally {
			saving = false;
		}
	}

	function deleteTemplate() {
		if (!selectedTemplate) return;
		modalStore.trigger({
			type: "confirm",
			title: "Delete Template",
			body: `Delete ${selectedTemplate.Name}?`,
			response: async (confirmed) => {
				if (!confirmed) return;
				try {
					await armoryStore.deleteTemplate(
						selectedTemplate.ID,
					);
					selectedTemplateId = null;
					selectedRunId = null;
					name = "";
					description = "";
					rawTemplate = "";
				} catch (error) {
					reportError(error);
				}
			},
		});
	}

	function toggleWordlist(wordlist) {
		selectedWordlists = selectedWordlists.includes(wordlist)
			? selectedWordlists.filter((name) => name !== wordlist)
			: [...selectedWordlists, wordlist];
	}

	function openWordlistModal() {
		if ($modalStore[0]) return;
		modalStore.trigger({
			type: "component",
			component: "SelectWordlist",
			meta: { selected: selectedWordlists },
			response: (name) => {
				if (name && !selectedWordlists.includes(name)) {
					selectedWordlists = [...selectedWordlists, name];
				}
			},
		});
	}

	async function createRun(start) {
		if (!selectedTemplate || validating || validationError) return;
		launching = true;
		try {
			if (!(await saveTemplate())) return;
			const run = await armoryStore.createRun({
				templateId: selectedTemplate.ID,
				attackType,
				useHTTPS,
				wordlists: selectedWordlists,
				maxConcurrent: Number(maxConcurrent),
			});
			selectedRunId = run.ID;
			if (start) await armoryStore.startRun(run.ID);
			notify(start ? "Run started" : "Draft run created");
		} catch (error) {
			reportError(error);
		} finally {
			launching = false;
		}
	}

	function selectRun(run) {
		selectedRunId = run.ID;
	}

	async function startRun(run) {
		try {
			await armoryStore.startRun(run.ID);
			selectedRunId = run.ID;
			notify("Run started");
		} catch (error) {
			reportError(error);
		}
	}

	async function cancelRun(run) {
		try {
			await armoryStore.cancelRun(run.ID);
			notify("Run cancellation requested");
		} catch (error) {
			reportError(error);
		}
	}

	function deleteRun(run) {
		modalStore.trigger({
			type: "confirm",
			title: "Delete Run",
			body: "Delete this run and its Armory history?",
			response: async (confirmed) => {
				if (!confirmed) return;
				try {
					await armoryStore.deleteRun(run.ID);
					if (selectedRunId === run.ID) {
						const remaining =
							$armoryStore.runsByTemplate[
								selectedTemplateId
							] || [];
						selectedRunId =
							remaining[0]?.ID ?? null;
					}
				} catch (error) {
					reportError(error);
				}
			},
		});
	}

	function openRequest(row, index) {
		drawerStore.open({
			id: "request-response",
			meta: {
				metadata: row.Metadata,
				request: { ID: row.ID },
				requestIndex: index + 1,
				isFiltered: false,
			},
			height: $drawerHeight,
			width: "w-full",
			position: "bottom",
		});
	}

	function adjacent(
		items,
		currentId,
		direction,
		getId = (item) => item.ID,
	) {
		if (items.length === 0) return;
		let index = items.findIndex(
			(item) => getId(item) === currentId,
		);
		if (index === -1) index = direction > 0 ? 0 : items.length - 1;
		else index = (index + direction + items.length) % items.length;
		return { item: items[index], index };
	}

	function cycleTemplate(direction) {
		const target = adjacent(
			$armoryStore.templates,
			selectedTemplateId,
			direction,
		);
		if (target) selectTemplate(target.item);
	}

	function cycleRun(direction) {
		const target = adjacent(runs, selectedRunId, direction);
		if (target) selectRun(target.item);
	}

	function cycleRequest(direction) {
		const currentIndex = requests.findIndex(
			(row) => row.ID === $drawerStore.meta?.request?.ID,
		);
		const index = currentIndex + direction;
		if (currentIndex !== -1 && requests[index]) {
			openRequest(requests[index], index);
		}
	}

	function statusClass(status) {
		switch (status) {
			case "complete":
				return "variant-filled-success";
			case "in_progress":
				return "variant-filled-primary";
			case "failed":
				return "variant-filled-error";
			case "cancelled":
				return "variant-filled-warning";
			default:
				return "variant-filled";
		}
	}

	async function refreshRuns() {
		if (!selectedTemplateId) return;
		try {
			await armoryStore.loadRuns(selectedTemplateId);
			notify("Runs refreshed");
		} catch (error) {
			reportError(error);
		}
	}

	async function pollRuns() {
		if (!$appState.isReady) return;
		const previousActiveRunIds = $armoryStore.activeRunIds || [];
		const activeRunIds = await armoryStore.refreshActiveRuns();
		const inProgressIds = Object.values(
			$armoryStore.runsByTemplate,
		)
			.flat()
			.filter((run) => run.Status === "in_progress")
			.map((run) => run.ID);
		const idsToRefresh = [...new Set([
			...previousActiveRunIds,
			...activeRunIds,
			...inProgressIds,
		])];

		await Promise.all(
			idsToRefresh.map((id) => armoryStore.refreshRun(id)),
		);
	}

	const armoryMenu = [
		{
			name: "Toggle Armory Settings",
			subtitle: "Toggle attack configuration",
			keywords: "settings, toggle, configuration",
			icon: ToggleLeft,
			action: {
				handler: () => {
					if (!$modalStore[0]) accOpened = !accOpened;
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+P", "ctrl+P"],
			},
		},
		{
			name: "Next Template",
			subtitle: "Select the next Armory template",
			keywords: "next template",
			icon: ArrowRight,
			action: {
				handler: () => cycleTemplate(1),
				options: { scope: "armory", single: true },
				keys: ["⌘+]", "ctrl+]"],
			},
		},
		{
			name: "Previous Template",
			subtitle: "Select the previous Armory template",
			keywords: "previous template",
			icon: ArrowLeft,
			action: {
				handler: () => cycleTemplate(-1),
				options: { scope: "armory", single: true },
				keys: ["⌘+[", "ctrl+["],
			},
		},
		{
			name: "Next Run",
			subtitle: "Select the next run for this template",
			keywords: "next run",
			icon: ArrowRight,
			action: {
				handler: () => cycleRun(1),
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+]", "ctrl+⇧+]"],
			},
		},
		{
			name: "Previous Run",
			subtitle: "Select the previous run for this template",
			keywords: "previous run",
			icon: ArrowLeft,
			action: {
				handler: () => cycleRun(-1),
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+[", "ctrl+⇧+["],
			},
		},
		{
			name: "Open First Request",
			subtitle: "Open the first request in the selected run",
			keywords: "open request drawer",
			icon: SquareArrowUpRight,
			action: {
				handler: () => {
					if (requests.length > 0) openRequest(requests[0], 0);
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+O", "ctrl+⇧+O"],
			},
		},
		{
			name: "Edit Armory Template",
			subtitle: "Jump to the request template editor",
			keywords: "edit template request",
			icon: Edit,
			action: {
				handler: () => {
					document.querySelector(".editor .cm-content")?.focus();
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+E", "ctrl+⇧+E"],
			},
		},
		{
			name: "Create Armory Template",
			subtitle: "Create a new request template",
			keywords: "create, new, template",
			icon: FilePlus2,
			action: {
				handler: () => {
					if (!$modalStore[0]) createTemplate();
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+T", "ctrl+⇧+T"],
			},
		},
		{
			name: "Save Armory Template",
			subtitle: "Save the selected request template",
			keywords: "save, template",
			icon: Save,
			action: {
				handler: () => {
					if (!$modalStore[0] && selectedTemplate)
						saveTemplate();
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+S", "ctrl+⇧+S"],
			},
		},
		{
			name: "Launch Armory Run",
			subtitle: "Save the template and start a run",
			keywords: "launch, start, run",
			icon: Rocket,
			action: {
				handler: () => {
					if (!$modalStore[0] && selectedTemplate)
						createRun(true);
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+L", "ctrl+⇧+L"],
			},
		},
		{
			name: "Cancel Armory Run",
			subtitle: "Cancel the selected active run",
			keywords: "cancel, stop, run",
			icon: CircleStop,
			action: {
				handler: () => {
					if (
						!$modalStore[0] &&
						selectedRun?.Status ===
							"in_progress"
					) {
						cancelRun(selectedRun);
					}
				},
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+C", "ctrl+⇧+C"],
			},
		},
		{
			name: "Refresh Armory Runs",
			subtitle: "Refresh run status",
			keywords: "refresh, runs, traffic",
			icon: RefreshCw,
			action: {
				handler: refreshRuns,
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+R", "ctrl+⇧+R"],
			},
		},
	];
	const drawerMenu = [
		{
			name: "Next Request",
			subtitle: "Open the next request in this run",
			keywords: "next request",
			icon: ArrowRight,
			action: {
				handler: () => cycleRequest(1),
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+]", "ctrl+⇧+]"],
			},
		},
		{
			name: "Previous Request",
			subtitle: "Open the previous request in this run",
			keywords: "previous request",
			icon: ArrowLeft,
			action: {
				handler: () => cycleRequest(-1),
				options: { scope: "armory", single: true },
				keys: ["⌘+⇧+[", "ctrl+⇧+["],
			},
		},
	];

	onMount(() => {
		validationReady = true;
		const unsubscribe = drawerStore.subscribe((settings) => {
			drawerOpened = settings.open && settings.id === "request-response";
			menu.menuOptions = drawerOpened ? drawerMenu : armoryMenu;
		});
		const interval = setInterval(async () => {
			const project = $activeProject;
			try {
				await pollRuns();
			} catch (error) {
				if (!$appState.isReady || project !== $activeProject)
					return;
				reportError(error);
			}
		}, 1500);

		return () => {
			drawerOpened = false;
			unsubscribe();
			clearInterval(interval);
			clearTimeout(validationTimer);
		};
	});
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
	<MarasiKeys bind:this={menu} scope="armory" menuOptions={armoryMenu} />
	<Accordion rounded="none" class="bg-surface-50 dark:bg-surface-900 text-surface-900-50-token">
		<AccordionItem bind:open={accOpened}>
			<svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
			<svelte:fragment slot="summary">Armory Settings</svelte:fragment>
			<svelte:fragment slot="content">Armory Settings</svelte:fragment>
		</AccordionItem>
	</Accordion>
	<div class="grid min-h-0 flex-1 grid-cols-[20%_minmax(0,1fr)_30%] grid-rows-[8rem_minmax(0,1fr)_auto] overflow-hidden">
			<header
				class="col-start-1 row-start-1 h-32 space-y-3 border-b border-r border-surface-500/30 p-4"
			>
				<div class="flex h-9 items-center justify-between">
					<h2 class="h3 font-bold">Templates</h2>
					<button
						type="button"
						class="btn btn-sm-icon {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
						aria-label="Create template"
						on:click={createTemplate}
					>
						<Plus size={18} />
					</button>
				</div>
				<div
					class="input-group input-group-divider grid-cols-[auto_1fr]"
				>
					<div class="input-group-shim">
						<Search size={16} />
					</div>
					<input
						type="search"
						placeholder="Search templates..."
						bind:value={search}
					/>
				</div>
			</header>

			<div
				class="col-start-1 row-start-2 row-span-2 min-h-0 space-y-2 overflow-y-auto border-r border-surface-500/30 p-2"
			>
				{#if filteredTemplates.length === 0}
					<p
						class="p-4 text-center text-sm opacity-60"
					>
						{query
							? "No matching templates"
							: "No templates yet"}
					</p>
				{:else}
					{#each filteredTemplates as template (template.ID)}
						<button
							type="button"
							class="w-full border-l-4 p-3 text-left transition-colors {template.ID ===
							selectedTemplateId
								? 'border-primary-500 bg-surface-200-700-token'
								: 'border-transparent hover:bg-surface-100-800-token'}"
							on:click={() =>
								selectTemplate(
									template,
								)}
						>
							<p
								class="truncate font-bold"
							>
								{template.Name}
							</p>
							{#if template.Description}
								<p
									class="mt-1 truncate text-xs opacity-60"
								>
									{template.Description}
								</p>
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			{#if selectedTemplate}
				<header
					class="col-start-2 row-start-1 h-32 space-y-3 border-b border-surface-500/30 p-4"
				>
					<div class="flex h-9 gap-2">
						<input
							class="input h-full flex-1"
							placeholder="Template name"
							bind:value={name}
						/>
						<button
							type="button"
							class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
							disabled={saving}
							on:click={saveTemplate}
						>
							<Save size={16} class="mr-1" /> Save
						</button>
						<button
							type="button"
							class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
							on:click={deleteTemplate}
						>
							<Trash2 size={16} />
						</button>
					</div>
					<input
						class="input"
						placeholder="Description"
						bind:value={description}
					/>
				</header>

				<section
					class="editor col-start-2 row-start-2 min-h-0 overflow-hidden dark:bg-[#282c34]"
				>
					<CodeMirror
						bind:value={rawTemplate}
						class="text-xs"
						theme={$modeCurrent ? githubLight : oneDark}
						extensions={$marasiConfig.VimEnabled
							? [
									vim(),
									StreamLanguage.define(
										http,
									),
									autocompletion({
										override: [
											armoryCompletionSource,
										],
									}),
								]
							: [
									StreamLanguage.define(
										http,
									),
									autocompletion({
										override: [
											armoryCompletionSource,
										],
									}),
								]}
						lineWrapping={$lineWrap}
					/>
				</section>

				<section
					class="col-start-2 row-start-3 space-y-4 border-t border-surface-500/30 p-4"
				>
					<div class="grid grid-cols-2 gap-4">
						<label class="label">
							<span>Attack type</span>
							<select
								class="select"
								bind:value={
									attackType
								}
							>
								{#each attackTypes as type}
									<option
										value={type}
										>{type}</option
									>
								{/each}
							</select>
							<span class="truncate text-xs opacity-60">
								{attackDescriptions[attackType]}
							</span>
						</label>
						<label class="label">
							<span>Concurrency</span>
							<input
								class="input"
								type="number"
								min="1"
								max="100"
								bind:value={
									maxConcurrent
								}
							/>
						</label>
					</div>

					<div class="flex items-center gap-2">
						<span class="text-sm font-bold">HTTPS</span>
						<SlideToggle
							name="Armory HTTPS"
							size="sm"
							bind:checked={useHTTPS}
						/>
					</div>
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="text-sm font-bold">Wordlists</p>
							<button
								type="button"
								class="btn btn-sm variant-soft"
								on:click={openWordlistModal}
							>
								<Plus size={14} class="mr-1" /> Add Wordlist
							</button>
						</div>
						<div class="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
							{#if selectedWordlists.length === 0}
								<span class="text-sm opacity-60">No wordlists selected</span>
							{:else}
								{#each selectedWordlists as wordlist (wordlist)}
									<span class="chip variant-soft-primary inline-flex items-center gap-1 px-2 py-0.5 text-xs">
										{wordlist}
										<button
											type="button"
											class="inline-flex"
											aria-label={`Remove ${wordlist}`}
											on:click={() => toggleWordlist(wordlist)}
										>
											<X size={12} />
										</button>
									</span>
								{/each}
							{/if}
						</div>
					</div>
					<div class="flex items-center justify-end gap-2">
						<button
							type="button"
							class="btn btn-sm variant-soft"
							disabled={launching ||
								validating ||
								!!validationError}
							on:click={() =>
								createRun(
									false,
								)}
							>Create Draft</button
						>
						<button
							type="button"
							class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
							disabled={launching ||
								validating ||
								!!validationError}
							on:click={() =>
								createRun(
									true,
								)}
						>
							<Rocket
								size={16}
								class="mr-1"
							/> Launch
						</button>
					</div>
					<p
						class="min-h-4 text-xs {String(
							validationError,
						).includes('requires exactly one wordlist')
							? 'text-primary-500'
							: 'text-error-500'}"
						class:invisible={!validationError}
						aria-live="polite"
					>
						{validationError || "Valid Armory configuration"}
					</p>
				</section>
			{:else}
				<div
					class="col-start-2 row-start-1 row-span-3 flex h-full items-center justify-center p-8 text-center opacity-60"
				>
					<div>
						<h2 class="h3 font-bold">
							No template selected
						</h2>
						<p class="mt-2 text-sm">
							Create or select a
							template to begin.
						</p>
					</div>
				</div>
			{/if}

				<header
					class="col-start-3 row-start-1 flex h-32 items-center justify-between border-b border-l border-surface-500/30 p-4"
				>
					<h2 class="font-bold">Runs</h2>
					<button
						type="button"
						class="btn btn-sm-icon variant-ghost"
						aria-label="Refresh runs"
						disabled={!selectedTemplateId}
						on:click={refreshRuns}
					>
						<RefreshCw size={16} />
					</button>
				</header>
				<div
					class="col-start-3 row-start-2 min-h-0 space-y-2 overflow-y-auto border-l border-surface-500/30 p-2"
				>
					{#if runs.length === 0}
						<p
							class="p-4 text-center text-sm opacity-60"
						>
							No runs for this
							template
						</p>
					{:else}
						{#each runs as run (run.ID)}
							<div
								class="card cursor-pointer space-y-2 border-l-4 p-3 {run.ID ===
								selectedRunId
									? 'border-primary-500 bg-surface-200-700-token'
									: 'border-transparent bg-surface-100-800-token'}"
								role="button"
								tabindex="0"
								on:click={() =>
									selectRun(
										run,
									)}
								on:keydown={(
									event,
								) =>
									event.key ===
										"Enter" &&
									selectRun(
										run,
									)}
							>
								<div
									class="flex items-center justify-between gap-2"
								>
									<span
										class="font-bold capitalize"
										>{run.AttackType}</span
									>
									<span
										class="badge {statusClass(
											run.Status,
										)}"
										>{run.Status.replace(
											"_",
											" ",
										)}</span
									>
								</div>
								<div
									class="flex items-center justify-between text-xs opacity-60"
								>
									<span
										>{run.MaxConcurrent}
										workers</span
									>
									<span
										>{new Date(
											run.CreatedAt,
										).toLocaleString()}</span
									>
								</div>
								<div
									class="flex justify-end gap-2"
								>
									{#if run.Status === "draft"}
										<button
											type="button"
											class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
											on:click|stopPropagation={() =>
												startRun(
													run,
												)}
										>
											<Rocket
												size={14}
												class="mr-1"
											/>
											Start
										</button>
									{:else if run.Status === "in_progress"}
										<button
											type="button"
											class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
											on:click|stopPropagation={() =>
												cancelRun(
													run,
												)}
										>
											<CircleStop
												size={14}
												class="mr-1"
											/>
											Cancel
										</button>
									{/if}
									{#if run.Status !== "in_progress"}
										<button
											type="button"
											class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
											on:click|stopPropagation={() =>
												deleteRun(
													run,
												)}
										>
											<Trash2
												size={14}
											/>
										</button>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
				</div>
				<section class="col-start-3 row-start-3 flex h-0 min-h-full flex-col overflow-hidden border-l border-t border-surface-500/30">
				<header
					class="border-b border-surface-500/30 p-4"
				>
					<h2 class="font-bold">
						Traffic {selectedRun
							? `(${requests.length})`
							: ""}
					</h2>
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto">
					{#if !selectedRun}
						<p
							class="p-4 text-center text-sm opacity-60"
						>
							Select a run to view
							traffic
						</p>
					{:else if requests.length === 0}
						<p
							class="p-4 text-center text-sm opacity-60"
						>
							No requests captured yet
						</p>
					{:else}
						{#each requests as row, index (row.ID)}
							<button
								type="button"
								class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-surface-500/20 p-3 text-left hover:bg-surface-100-800-token"
								on:click={() =>
									openRequest(
										row,
										index,
									)}
							>
								<span
									class="badge variant-soft-primary font-mono"
									>{row.Method}</span
								>
								<span
									class="truncate text-sm"
									>{row.Host}{row.Path}</span
								>
								<span
									class="font-mono text-sm"
									>{row.StatusCode >
									0
										? row.StatusCode
										: "-"}</span
								>
							</button>
						{/each}
					{/if}
				</div>
			</section>
	</div>
</div>

<style>
	.editor :global(.cm-editor) {
		height: 100%;
	}
</style>
