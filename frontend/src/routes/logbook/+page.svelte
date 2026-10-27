<script context="module">
	// The dock's width survives page visits within a session.
	let savedDock;
</script>

<script>
	// The Logbook page, in the Ledger's frame: the dock holds the outline
	// and the create and status controls, the toolbar filters, and the
	// workspace shows the summary. A record still opens in today's finding
	// or test case modal.
	import { getDrawerStore, getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { writable } from "svelte/store";
	import { BookCheck, Search, ShieldAlert, SquareArrowRightIcon, ToggleLeftIcon } from "lucide-svelte";
	import Dock from "../../lib/dock/Dock.svelte";
	import { LEDGER_DOCK } from "../../lib/dock/dock.js";
	import { primaryVariant } from "../../lib/launchpad/format.js";
	import LogbookOutline from "../../lib/logbook/LogbookOutline.svelte";
	import LogbookSummary from "../../lib/logbook/LogbookSummary.svelte";
	import LogbookToolbar from "../../lib/logbook/LogbookToolbar.svelte";
	import { findingStore } from "../../stores/findingStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { logbookStore } from "../../stores/logbookStore";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";

	const modalStore = getModalStore();
	const drawerStore = getDrawerStore();
	const dockState = writable(savedDock ?? { width: LEDGER_DOCK.default, collapsed: false });
	$: savedDock = $dockState;

	let dock;
	let searchInput;

	$: primary = primaryVariant($modeCurrent);
	$: tertiary = $modeCurrent ? "variant-ghost-tertiary ring-0 shadow-none" : "variant-filled-tertiary";
	$: empty = $logbookStore.findings.length === 0 && $logbookStore.testCases.length === 0;

	function openFindingModal(finding, isNew) {
		if ($modalStore[0]) return;
		modalStore.trigger({
			type: "component",
			component: "Finding",
			toggleAction: "logbook.create-finding",
			meta: { finding, isNew },
		});
	}

	function openTestCaseModal(testCase, isNew) {
		if ($modalStore[0]) return;
		modalStore.trigger({
			type: "component",
			component: "TestCase",
			toggleAction: "logbook.create-test-case",
			meta: { testCase, isNew },
		});
	}

	// Marks the record in the outline and opens it in today's modal.
	function openRecord(kind, id) {
		if ($modalStore[0]) return;
		const records = kind === "finding" ? $logbookStore.findings : $logbookStore.testCases;
		const record = records.find((r) => r.ID === id);
		if (!record) return;
		logbookStore.open(kind, id);
		if (kind === "finding") openFindingModal(record, false);
		else openTestCaseModal(record, false);
	}

	function newFinding() {
		if (!$modalStore[0]) findingStore.create([]).then((finding) => openFindingModal(finding, true));
		else if ($modalStore[0].component === "Finding") modalStore.close();
	}

	function newTestCase() {
		if (!$modalStore[0]) testCaseStore.create([]).then((testCase) => openTestCaseModal(testCase, true));
		else if ($modalStore[0].component === "TestCase") modalStore.close();
	}

	function openExportDrawer() {
		if ($modalStore[0] || empty) return;
		if (!$drawerStore || Object.keys($drawerStore).length === 0 || !$drawerStore.open)
			drawerStore.open({
				id: "report-export",
				position: "right",
				width: "w-full md:w-[50%]",
				height: "h-full",
				rounded: "rounded-none",
			});
		else if ($drawerStore.id === "report-export" && $drawerStore.open) drawerStore.close();
	}

	const logbookMenu = [
		{
			actionId: "logbook.toggle-settings",
			icon: ToggleLeftIcon,
			handler: () => {
				if (!$modalStore[0]) dock?.toggle();
			},
		},
		{
			actionId: "logbook.focus-search",
			icon: Search,
			handler: () => {
				if ($modalStore[0] || !searchInput) return;
				if (document.activeElement === searchInput) searchInput.blur();
				else searchInput.focus();
			},
		},
		{ actionId: "logbook.create-finding", icon: ShieldAlert, handler: newFinding },
		{ actionId: "logbook.create-test-case", icon: BookCheck, handler: newTestCase },
		{ actionId: "logbook.export-report", icon: SquareArrowRightIcon, handler: openExportDrawer },
	];
	useMenuActions(logbookMenu);
</script>

<MarasiKeys menuOptions={logbookMenu} />

<div class="logbook-page relative flex h-full min-h-0 overflow-hidden text-xs">
	<Dock
		bind:this={dock}
		state={dockState}
		limits={LEDGER_DOCK}
		stripLabel="Logbook"
		expandLabel="Show the outline"
		searchLabel="Search the Logbook"
		collapseLabel="Collapse the outline"
		{searchInput}
	>
		<svelte:fragment slot="strip">
			<button
				class="btn btn-sm px-2 {primary}"
				title="New finding"
				aria-label="New finding"
				on:click={newFinding}><ShieldAlert size={16} /></button
			>
			<button
				class="btn btn-sm px-2 {tertiary}"
				title="New test case"
				aria-label="New test case"
				on:click={newTestCase}><BookCheck size={16} /></button
			>
		</svelte:fragment>
		<LogbookOutline store={logbookStore} onOpen={openRecord} onNewFinding={newFinding} onNewTestCase={newTestCase} />
	</Dock>
	<section class="flex min-w-0 flex-1 flex-col">
		<LogbookToolbar
			store={logbookStore}
			bind:searchInput
			onExport={openExportDrawer}
			exportDisabled={empty}
		/>
		<div class="min-h-0 flex-1 bg-surface-50 dark:bg-surface-900">
			<LogbookSummary store={logbookStore} onOpen={openRecord} />
		</div>
	</section>
</div>
