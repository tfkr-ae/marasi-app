<script context="module">
	// Whether Run settings and the traffic panel are open survives page
	// visits within a session.
	let savedSettingsOpen = true;
	let savedTrafficOpen = true;
	// Whether the drawer shows its details column, as in the Ledger.
	let savedDrawerExpanded = false;
	// The project state these belong to; a project opened since the last
	// visit puts them back to their defaults.
	let savedVersion = null;
</script>

<script>
	// The Armory page: the template dock (lib/armory/ArmoryDock.svelte) on
	// the left; on the right the selected template's header and editor, its
	// Run settings, and the selected run's traffic at the bottom. A traffic
	// row opens ArmoryDrawer over the bottom of the workspace, right of the
	// dock. The page holds the selection, draft and settings and keeps
	// armoryStore in step.
	import { onMount } from "svelte";
	import { get, writable } from "svelte/store";
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import {
		ArrowLeft,
		ArrowRight,
		ChevronDown,
		ChevronRight,
		CircleStop,
		Edit,
		FilePlus2,
		RefreshCw,
		Rocket,
		Save,
		SquareArrowUpRight,
		ToggleLeft,
	} from "lucide-svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { armoryDrawer, useMenuActions } from "../../lib/keybindings/app.js";
	import { armoryStore, drawerShareOf } from "../../stores/armoryStore";
	import { activeProject, appState } from "../../stores";
	import { recentTraffic } from "../../stores/recentTrafficStore";
	import { ledgerStore } from "../../stores/ledgerStore";
	import { launchpadStore } from "../../stores/launchpadStore";
	import { findingStore } from "../../stores/findingStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { runTraffic } from "../../lib/armoryRunTraffic.js";
	import { sameID } from "../../lib/ledger/pairs.js";
	import { linkedTo } from "../../lib/ledger/drawer.js";
	import { newRecord } from "../../lib/logbook/recordEditor.js";
	import { toastError, toastJump } from "../../lib/toasts.js";
	import { UNTITLED_LAUNCHPAD } from "../../lib/launchpad/format.js";
	import { stepRequest } from "../../lib/armory/traffic.js";
	import { armoryMenuFor } from "../../lib/armory/rowMenu.js";
	import RowMenu from "../../lib/ledger/RowMenu.svelte";
	import ArmoryDock from "../../lib/armory/ArmoryDock.svelte";
	import ArmoryDrawer from "../../lib/armory/ArmoryDrawer.svelte";
	import DrawerLinked from "../../lib/ledger/DrawerLinked.svelte";
	import RunSettings from "../../lib/armory/RunSettings.svelte";
	import TemplateEditor from "../../lib/armory/TemplateEditor.svelte";
	import TemplateHeader from "../../lib/armory/TemplateHeader.svelte";
	import TrafficRegion from "../../lib/armory/TrafficRegion.svelte";

	const modalStore = getModalStore();
	const toastStore = getToastStore();

	const savedArmoryState = get(armoryStore);
	if (savedVersion !== savedArmoryState.projectStateVersion) {
		savedVersion = savedArmoryState.projectStateVersion;
		savedSettingsOpen = true;
		savedTrafficOpen = true;
		savedDrawerExpanded = false;
	}
	const savedTemplateId = savedArmoryState.selectedTemplateId;
	const savedTemplateDraft = savedArmoryState.templateDraft?.templateId ===
		savedTemplateId
		? savedArmoryState.templateDraft
		: null;
	const savedRunSettings = savedArmoryState.runSettingsByTemplate[
		savedTemplateId
	] || {
		attackType: "harpoon",
		useHTTPS: true,
		selectedWordlists: [],
		maxConcurrent: 10,
	};

	let search = savedArmoryState.search;
	let selectedTemplateId = savedTemplateId;
	let selectedRunId = savedArmoryState.selectedRunByTemplate[
		savedTemplateId
	] ?? null;
	let name = savedTemplateDraft?.name || "";
	let description = savedTemplateDraft?.description || "";
	let rawTemplate = savedTemplateDraft?.rawTemplate || "";
	let attackType = savedRunSettings.attackType;
	let useHTTPS = savedRunSettings.useHTTPS;
	let selectedWordlists = [...savedRunSettings.selectedWordlists];
	let maxConcurrent = savedRunSettings.maxConcurrent;
	let saving = false;
	let launching = false;
	let validating = true;
	let validationError = "";
	let validationReady = false;
	let validationTimer;
	let validationRequest = 0;
	let settingsOpen = savedSettingsOpen;
	// The drawer's pair, by ID: its row comes from `requests`, so it follows
	// the live traffic (a response arriving).
	let openId = null;
	let drawerMaximised = false;
	let drawerExpanded = savedDrawerExpanded;
	let workspace;
	// Measured for the drawer's height until it is dragged (drawerShareOf):
	// the traffic section's with its top border, so the edges meet.
	let workspaceHeight = 0;
	let trafficHeight = 0;
	let templateEditor;
	let paginatedRunId = null;
	let handledRouteTemplateId = null;
	let projectStateVersion = savedArmoryState.projectStateVersion;

	let trafficOpen = savedTrafficOpen;

	$: savedSettingsOpen = settingsOpen;
	$: savedTrafficOpen = trafficOpen;
	$: savedDrawerExpanded = drawerExpanded;
	$: drawerShare = drawerShareOf($armoryStore, { trafficOpen, trafficHeight, workspaceHeight });

	const trafficPagination = writable({
		pageIndex: selectedRunId
			? savedArmoryState.trafficPageByRun[selectedRunId] || 0
			: 0,
		pageSize: savedArmoryState.trafficPageSize,
	});

	function setTrafficPagination(updater) {
		trafficPagination.update((old) => {
			const next = updater instanceof Function ? updater(old) : updater;
			armoryStore.setTrafficPagination(selectedRunId, next);
			return next;
		});
	}

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
	$: runs = filteredTemplates.some(
		(template) => template.ID === selectedTemplateId,
	)
		? $armoryStore.runsByTemplate[selectedTemplateId] || []
		: [];
	$: selectedRun = runs.find((run) => run.ID === selectedRunId);
	// The run's pairs load when it is chosen; the recent traffic adds the
	// ones it sends after that.
	let runTrafficId = null;
	let loadedRunTraffic = [];
	$: if ((selectedRun ? selectedRunId : null) !== runTrafficId) {
		const runId = selectedRun ? selectedRunId : null;
		runTrafficId = runId;
		loadedRunTraffic = [];
		if (runId != null) {
			armoryStore
				.getRunTraffic(runId)
				.then((items) => {
					if (runTrafficId === runId) loadedRunTraffic = items ?? [];
				})
				.catch((err) => console.error("Loading run traffic failed:", err));
		}
	}
	$: requests = selectedRun
		? runTraffic(loadedRunTraffic, $recentTraffic, selectedRunId)
		: [];
	$: openIndex = openId == null ? -1 : requests.findIndex((row) => sameID(row.ID, openId));
	$: openRow = openIndex === -1 ? null : requests[openIndex];
	$: drawerOpen = openRow != null;
	$: armoryDrawer.set({ open: drawerOpen });
	$: if ($armoryStore.projectStateVersion !== projectStateVersion) {
		projectStateVersion = $armoryStore.projectStateVersion;
		savedVersion = projectStateVersion;
		search = $armoryStore.search;
		selectedTemplateId = null;
		selectedRunId = null;
		name = "";
		description = "";
		rawTemplate = "";
		attackType = "harpoon";
		useHTTPS = true;
		selectedWordlists = [];
		maxConcurrent = 10;
		paginatedRunId = null;
		handledRouteTemplateId = null;
		settingsOpen = true;
		trafficOpen = true;
		drawerExpanded = false;
		trafficPagination.set({ pageIndex: 0, pageSize: 100 });
	}
	$: if (selectedRunId !== paginatedRunId) {
		paginatedRunId = selectedRunId;
		trafficPagination.set({
			pageIndex: selectedRunId
				? $armoryStore.trafficPageByRun[selectedRunId] || 0
				: 0,
			pageSize: $armoryStore.trafficPageSize,
		});
		closeRequestDrawer();
	}
	$: if (
		$trafficPagination.pageIndex >
		Math.max(
			0,
			Math.ceil(requests.length / $trafficPagination.pageSize) - 1,
		)
	) {
		setTrafficPagination((old) => ({
			...old,
			pageIndex: Math.max(
				0,
				Math.ceil(requests.length / old.pageSize) - 1,
			),
		}));
	}
	$: if (!selectedTemplate && $armoryStore.templates.length > 0) {
		selectTemplate($armoryStore.templates[0]);
	}
	$: routeTemplateId = $page.url.searchParams.get("id");
	$: if (!routeTemplateId) handledRouteTemplateId = null;
	$: if (routeTemplateId && routeTemplateId !== handledRouteTemplateId) {
		const routeTemplate = $armoryStore.templates.find(
			(template) => template.ID === routeTemplateId,
		);
		if (routeTemplate) {
			handledRouteTemplateId = routeTemplateId;
			selectTemplate(routeTemplate);
		}
	}
	$: armoryStore.setSearch(search);
	$: if (selectedTemplateId) {
		armoryStore.updateTemplateDraft(selectedTemplateId, {
			name,
			description,
			rawTemplate,
		});
		armoryStore.updateRunSettings(selectedTemplateId, {
			attackType,
			useHTTPS,
			selectedWordlists,
			maxConcurrent,
		});
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
		const selection = armoryStore.selectTemplate(template);
		selectedTemplateId = template.ID;
		selectedRunId = selection.selectedRunId;
		name = selection.templateDraft.name;
		description = selection.templateDraft.description;
		rawTemplate = selection.templateDraft.rawTemplate;
		attackType = selection.settings.attackType;
		useHTTPS = selection.settings.useHTTPS;
		selectedWordlists = [...selection.settings.selectedWordlists];
		maxConcurrent = selection.settings.maxConcurrent;
		await loadRuns(template);
	}

	async function loadRuns(template) {
		try {
			await armoryStore.loadRuns(template.ID);
		} catch (error) {
			reportError(error);
		}
	}

	function createTemplate() {
		modalStore.trigger({
			type: "component",
			component: "MenuInput",
			title: "New Armory Template",
			body: "Enter a name for the request template.",
			meta: { placeholder: "Template name" },
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
			armoryStore.selectRun(selectedTemplate.ID, run.ID);
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
		armoryStore.selectRun(selectedTemplateId, run.ID);
	}

	// A run picked in the dock may belong to another template; that template
	// is selected first.
	function selectTemplateRun(template, run) {
		if (template.ID !== selectedTemplateId) selectTemplate(template);
		selectRun(run);
	}

	async function startRun(run) {
		try {
			await armoryStore.startRun(run.ID);
			if (run.TemplateID === selectedTemplateId) selectedRunId = run.ID;
			armoryStore.selectRun(run.TemplateID, run.ID);
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
						selectedRunId = remaining[0]?.ID ?? null;
						armoryStore.selectRun(
							selectedTemplateId,
							selectedRunId,
						);
					}
				} catch (error) {
					reportError(error);
				}
			},
		});
	}

	function openRequest(row) {
		openId = row.ID;
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

	// The dock keeps the newly selected row in view.
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

	// Steps through the run's traffic, turning the table's page with it.
	function cycleRequest(direction) {
		const index = stepRequest(requests, openId, direction);
		if (index === -1) return;
		setTrafficPagination((old) => ({
			...old,
			pageIndex: Math.floor(index / old.pageSize),
		}));
		openRequest(requests[index]);
	}

	function closeRequestDrawer() {
		openId = null;
		drawerMaximised = false;
	}

	// Esc closes the drawer wherever focus is, unless a modal, the Marasi
	// menu or the row menu has the key. It runs in the capture phase, before
	// an editor can stop it, and leaves the key to a focused field or editor
	// too, so Vim still leaves insert mode. The row menu's own capture
	// listener runs first (Svelte adds this one after the page's children)
	// and claims the key with preventDefault as it closes.
	function onWindowKeydown(event) {
		if (event.key !== "Escape" || event.defaultPrevented) return;
		if (!drawerOpen || $modalStore[0] || rowMenu.open) return;
		if (document.querySelector("dialog[open]")) return;
		if (!event.target?.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor")) {
			event.preventDefault();
		}
		closeRequestDrawer();
	}

	// Drag the drawer's top edge to resize it, as in the Ledger.
	function startDrawerResize(event) {
		event.preventDefault();
		const rect = workspace.getBoundingClientRect();
		const move = (e) => armoryStore.setDrawerSplit((rect.bottom - e.clientY) / rect.height);
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	const COPIED = { request: "Request copied", response: "Response copied", url: "URL copied" };
	function copyFromDrawer(text, what) {
		navigator.clipboard
			.writeText(text)
			.then(() => notify(COPIED[what]))
			.catch(() => notify("Copy failed", "variant-filled-error"));
	}

	// The traffic row menu (lib/armory/rowMenu.js, drawn by the Ledger's
	// RowMenu), opened by right-clicking a row or by the drawer's Actions.
	// Its actions run through the Ledger's store methods, as the Ledger's
	// row menu does, on the one pair it was opened for.
	let rowMenu = { open: false, x: 0, y: 0, pair: null, number: null };

	function openRowMenu(row, index, event) {
		rowMenu = { open: true, x: event.clientX, y: event.clientY, pair: row, number: row.Number || index + 1 };
	}

	function openDrawerMenu(event) {
		if (!openRow) return;
		const rect = event.currentTarget.getBoundingClientRect();
		rowMenu = { open: true, x: rect.left, y: rect.bottom, pair: openRow, number: openRow.Number || openIndex + 1 };
	}

	$: rowMenuItems =
		rowMenu.open && rowMenu.pair
			? armoryMenuFor([rowMenu.pair], {
					launchpads: $launchpadStore.launchpads,
					findings: $findingStore,
					testCases: $testCaseStore,
				})
			: [];

	// The Ledger's handoff toast.
	function notifyJump(message, path) {
		toastJump(toastStore, message, "Jump to Launchpad", $modeCurrent, () => goto(path));
	}

	const refreshLaunchpads = () =>
		launchpadStore.populate().catch((err) => console.error("Refreshing launchpads failed:", err));

	async function sendToNewLaunchpad(pair) {
		// The Ledger knows numbers only for pairs it has loaded; Armory's row
		// knows its own.
		const numberOf = (id) => pair.Number || ledgerStore.pairNumber(id);
		try {
			const { launchpadId } = await ledgerStore.sendToNewLaunchpad({ ids: [String(pair.ID)] }, 1, { numberOf });
			refreshLaunchpads();
			notifyJump("Sent to a new launchpad", `/launchpad?id=${launchpadId}`);
		} catch (error) {
			toastError(toastStore, "Failed to create a launchpad", error);
		}
	}

	async function addToLaunchpad(pair, launchpadId, name) {
		try {
			const count = await ledgerStore.addToLaunchpad({ ids: [String(pair.ID)] }, launchpadId);
			refreshLaunchpads();
			if (count) notifyJump(`Added to "${name || UNTITLED_LAUNCHPAD}"`, `/launchpad?id=${launchpadId}`);
		} catch (error) {
			toastError(toastStore, "Failed to add to the launchpad", error);
		}
	}

	// Links or unlinks the pair and a finding or test case.
	const LINKS = {
		"link-finding": ["link", "Linked to", "finding", (sel, id) => ledgerStore.linkToFinding(sel, id)],
		"unlink-finding": ["unlink", "Unlinked from", "finding", (sel, id) => ledgerStore.unlinkFromFinding(sel, id)],
		"link-test-case": ["link", "Linked to", "test case", (sel, id) => ledgerStore.linkToTestCase(sel, id)],
		"unlink-test-case": ["unlink", "Unlinked from", "test case", (sel, id) =>
			ledgerStore.unlinkFromTestCase(sel, id)],
	};
	async function changeLink(pair, type, id, title) {
		const [verb, done, noun, run] = LINKS[type];
		try {
			const count = await run({ ids: [String(pair.ID)] }, id);
			if (count) notify(`${done} ${noun} "${title}"`);
		} catch (error) {
			toastError(toastStore, `Failed to ${verb} the ${noun}`, error);
		}
	}

	/** Runs a row menu action (lib/armory/rowMenu.js) on `pair`. */
	function runRowAction(action, pair) {
		if (!action || !pair) return;
		switch (action.type) {
			case "new-launchpad":
				return sendToNewLaunchpad(pair);
			case "add-to-launchpad":
				return addToLaunchpad(pair, action.id, action.name);
			case "new-finding":
				return newRecord(modalStore, "finding", { requestIds: [pair.ID] });
			case "new-test-case":
				return newRecord(modalStore, "testCase", { requestIds: [pair.ID] });
			case "link-finding":
			case "unlink-finding":
			case "link-test-case":
			case "unlink-test-case":
				return changeLink(pair, action.type, action.id, action.title);
		}
	}

	$: linkedFindings = openRow ? linkedTo(openRow.ID, $findingStore) : [];
	$: linkedTestCases = openRow ? linkedTo(openRow.ID, $testCaseStore) : [];

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
		if (activeRunIds === null) return;
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
			// The id predates the redesign; it now shows or hides Run settings.
			actionId: "armory.page.toggle-settings",
			icon: ToggleLeft,
			handler: () => {
				if (!$modalStore[0]) settingsOpen = !settingsOpen;
			},
		},
		{
			actionId: "armory.page.next-template",
			icon: ArrowRight,
			handler: () => cycleTemplate(1),
		},
		{
			actionId: "armory.page.previous-template",
			icon: ArrowLeft,
			handler: () => cycleTemplate(-1),
		},
		{
			actionId: "armory.page.next-run",
			icon: ArrowRight,
			handler: () => cycleRun(1),
		},
		{
			actionId: "armory.page.previous-run",
			icon: ArrowLeft,
			handler: () => cycleRun(-1),
		},
		{
			actionId: "armory.page.open-first-request",
			icon: SquareArrowUpRight,
			handler: () => {
				if (requests.length > 0) openRequest(requests[0]);
			},
		},
		{
			actionId: "armory.page.edit-template",
			icon: Edit,
			handler: () => templateEditor?.focus(),
		},
		{
			actionId: "armory.page.create-template",
			icon: FilePlus2,
			handler: () => {
				if (!$modalStore[0]) createTemplate();
			},
		},
		{
			actionId: "armory.page.save-template",
			icon: Save,
			handler: () => {
				if (!$modalStore[0] && selectedTemplate)
					saveTemplate();
			},
		},
		{
			actionId: "armory.page.launch-run",
			icon: Rocket,
			handler: () => {
				if (!$modalStore[0] && selectedTemplate)
					createRun(true);
			},
		},
		{
			actionId: "armory.page.cancel-run",
			icon: CircleStop,
			handler: () => {
				if (
					!$modalStore[0] &&
					selectedRun?.Status ===
						"in_progress"
				) {
					cancelRun(selectedRun);
				}
			},
		},
		{
			actionId: "armory.page.refresh-runs",
			icon: RefreshCw,
			handler: refreshRuns,
		},
	];
	const drawerMenu = [
		{
			actionId: "armory.drawer.next-request",
			icon: ArrowRight,
			handler: () => cycleRequest(1),
		},
		{
			actionId: "armory.drawer.previous-request",
			icon: ArrowLeft,
			handler: () => cycleRequest(-1),
		},
	];
	// The armory.page and armory.drawer menu contexts decide which of these
	// a key reaches; the menu lists the actions of the drawer's state.
	useMenuActions([...armoryMenu, ...drawerMenu]);
	$: menuOptions = drawerOpen ? drawerMenu : armoryMenu;

	onMount(() => {
		validationReady = true;
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
			armoryDrawer.set({ open: false });
			modalStore.close();
			clearInterval(interval);
			clearTimeout(validationTimer);
		};
	});
</script>

<svelte:window on:keydown|capture={onWindowKeydown} />

<div class="flex h-full min-h-0 overflow-hidden text-sm">
	<MarasiKeys {menuOptions} />
	<ArmoryDock
		templates={filteredTemplates}
		runsByTemplate={$armoryStore.runsByTemplate}
		{selectedTemplateId}
		{selectedRunId}
		{projectStateVersion}
		bind:search
		onSelectTemplate={selectTemplate}
		onSelectRun={selectTemplateRun}
		onExpand={loadRuns}
		onCreate={createTemplate}
		onRefresh={refreshRuns}
		onStartRun={startRun}
		onCancelRun={cancelRun}
		onDeleteRun={deleteRun}
	/>

	<div bind:this={workspace} bind:clientHeight={workspaceHeight} class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
		{#if selectedTemplate}
			<TemplateHeader
				bind:name
				bind:description
				{saving}
				onSave={saveTemplate}
				onDelete={deleteTemplate}
			/>
			<!-- Editor and Run settings side by side when wide, stacked when narrow. -->
			<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
				<section class="min-h-24 min-w-0 flex-1">
					<TemplateEditor bind:this={templateEditor} bind:value={rawTemplate} />
				</section>
				<section
					class="flex flex-none flex-col border-t border-surface-500/30 lg:border-l lg:border-t-0 {settingsOpen
						? 'lg:w-80'
						: 'lg:w-9'}"
				>
					<button
						type="button"
						class="flex flex-none items-center gap-1.5 bg-surface-50 px-3 py-1.5 text-left text-xs font-bold dark:bg-surface-900 {settingsOpen
							? 'border-b border-surface-500/30'
							: 'lg:h-full lg:flex-col lg:px-0 lg:py-2'}"
						aria-expanded={settingsOpen}
						title={settingsOpen ? "Hide run settings" : "Show run settings"}
						on:click={() => (settingsOpen = !settingsOpen)}
					>
						{#if settingsOpen}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
						<span class={settingsOpen ? "" : "lg:[writing-mode:vertical-rl]"}>Run settings</span>
					</button>
					{#if settingsOpen}
						<div class="flex max-h-80 min-h-0 flex-col lg:max-h-none lg:flex-1">
							<RunSettings
								bind:attackType
								bind:useHTTPS
								bind:selectedWordlists
								bind:maxConcurrent
								{launching}
								{validating}
								{validationError}
								onLaunch={() => createRun(true)}
								onDraft={() => createRun(false)}
							/>
						</div>
					{/if}
				</section>
			</div>
			<div
				class="flex-none border-t border-surface-500/30 {trafficOpen ? 'h-[38%] min-h-36' : ''}"
				bind:offsetHeight={trafficHeight}
			>
				<TrafficRegion
					bind:open={trafficOpen}
					requests={selectedRun ? requests : null}
					openId={openRow?.ID ?? null}
					pagination={trafficPagination}
					onPaginationChange={setTrafficPagination}
					onPageChange={closeRequestDrawer}
					onOpen={openRequest}
					onMenu={openRowMenu}
				/>
			</div>
			{#if openRow}
				<!-- Over the bottom of the workspace only, so it moves with the
				     dock. The red top line is drawn over the drawer, as in the
				     Ledger, so CodeMirror's sticky gutters can't paint over it. -->
				<div
					class="armory-drawer-box absolute inset-x-0 bottom-0 isolate z-40 {drawerMaximised ? 'top-0' : ''}"
					style={drawerMaximised ? "" : `height: ${drawerShare * 100}%`}
				>
					{#if !drawerMaximised}
						<div
							class="pointer-events-none absolute inset-x-0 top-0 z-[300] h-px bg-primary-500"
							aria-hidden="true"
						></div>
						<!-- The handle takes no room: it straddles the red top line. -->
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<div
							class="armory-drawer-resize absolute inset-x-0 -top-1 z-[301] h-2 cursor-row-resize hover:bg-primary-500/50"
							title="Drag to resize the drawer"
							on:pointerdown={startDrawerResize}
						></div>
					{/if}
					<ArmoryDrawer
						pair={openRow}
						number={openRow.Number || openIndex + 1}
						maximised={drawerMaximised}
						bind:expanded={drawerExpanded}
						onClose={closeRequestDrawer}
						onStep={cycleRequest}
						onMaximise={() => (drawerMaximised = !drawerMaximised)}
						onCopy={copyFromDrawer}
						onActions={openDrawerMenu}
					>
						<svelte:fragment slot="details">
							<DrawerLinked
								findings={linkedFindings}
								testCases={linkedTestCases}
								onUnlink={(kind, target, title) =>
									changeLink(
										openRow,
										kind === "finding" ? "unlink-finding" : "unlink-test-case",
										target.ID,
										title,
									)}
							/>
						</svelte:fragment>
					</ArmoryDrawer>
				</div>
			{/if}
		{:else}
			<div class="flex h-full items-center justify-center p-8 text-center opacity-60">
				<div>
					<h2 class="text-base font-bold">No template selected</h2>
					<p class="mt-1 text-xs">Create or select a template to begin.</p>
				</div>
			</div>
		{/if}
	</div>
</div>

<RowMenu
	bind:open={rowMenu.open}
	x={rowMenu.x}
	y={rowMenu.y}
	pairs={rowMenu.pair ? [rowMenu.pair] : []}
	items={rowMenuItems}
	context={{ numberOf: () => rowMenu.number }}
	extendHint={false}
	on:action={(e) => runRowAction(e.detail, rowMenu.pair)}
/>
