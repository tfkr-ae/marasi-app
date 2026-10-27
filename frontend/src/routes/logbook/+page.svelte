<script context="module">
	// The dock's width survives page visits within a session.
	let savedDock;
</script>

<script>
	// The Logbook page, in the Ledger's frame: the dock holds the outline
	// and the create and status controls, the toolbar filters, and the
	// workspace shows the summary, or a record in its place. Back and Esc
	// return to the list, Next and N (logbook.next-record) move through it.
	// A record opens on its first missing item (or the one asked for),
	// filled in place; moving away from one with input asks first. Edit
	// opens the modal.
	import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
	import { writable } from "svelte/store";
	import { ArrowRight, BookCheck, Search, ShieldAlert, SquareArrowRightIcon } from "lucide-svelte";
	import Dock from "../../lib/dock/Dock.svelte";
	import { LEDGER_DOCK } from "../../lib/dock/dock.js";
	import { primaryVariant, tertiaryVariant } from "../../lib/launchpad/format.js";
	import LogbookOutline from "../../lib/logbook/LogbookOutline.svelte";
	import LogbookRecord from "../../lib/logbook/LogbookRecord.svelte";
	import LogbookSummary from "../../lib/logbook/LogbookSummary.svelte";
	import LogbookToolbar from "../../lib/logbook/LogbookToolbar.svelte";
	import { logbookStore, nextOf, openRecordOf } from "../../stores/logbookStore";
	import { editRecord, newRecord } from "../../lib/logbook/recordEditor.js";
	import { toastError } from "../../lib/toasts.js";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { menuDispatcher, useMenuActions } from "../../lib/keybindings/app.js";
	import { shortcutLabel } from "../../lib/keybindings/keys.js";

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const dockState = writable(savedDock ?? { width: LEDGER_DOCK.default, collapsed: false });
	$: savedDock = $dockState;

	let dock;
	let searchInput;

	$: primary = primaryVariant($modeCurrent);
	$: tertiary = tertiaryVariant($modeCurrent);
	$: empty = $logbookStore.findings.length === 0 && $logbookStore.testCases.length === 0;

	$: opened = openRecordOf($logbookStore);
	$: next = nextOf($logbookStore);
	// Next's tooltip names the live key, since N can be remapped.
	$: nextKey = shortcutLabel($menuDispatcher, "logbook.next-record");
	$: nextLabel = $logbookStore.filters.status === "all" ? "Next in progress" : "Next";
	$: nextTitle = nextKey ? `${nextLabel} (${nextKey})` : nextLabel;

	// Opens the record in the workspace, in place of the list.
	function openRecord(kind, id) {
		if ($modalStore[0]) return;
		logbookStore.open(kind, id);
	}

	// Edit opens the record in the modal, over its edit session. An inline
	// fix with input asks first (Keep editing or Discard).
	function editOpened() {
		if (!opened || $modalStore[0]) return;
		const { kind, record } = opened;
		logbookStore.guard(() => editRecord(modalStore, kind, record.ID));
	}

	function deleteRecord() {
		if (!opened || $modalStore[0]) return;
		const { kind, record } = opened;
		const finding = kind === "finding";
		modalStore.trigger({
			type: "confirm",
			title: finding ? "Delete finding" : "Delete test case",
			body: `Delete "${record.Title}"?`,
			buttonTextConfirm: "Delete",
			// The record closes only once it is gone; a failure keeps it open.
			response: async (yes) => {
				if (!yes) return;
				const result = await logbookStore.deleteRecord(kind, record.ID);
				if (!result.ok) toastError(toastStore, "Not deleted", result.error);
			},
		});
	}

	// Esc goes back to the list, unless a modal, a field or an editor has the
	// key. Esc is reserved for the page (gate.js), so it is handled here, not
	// in the menu. Whether a modal was open is noted before the key reaches
	// it, since its own Esc closes it first.
	let modalHadKey = false;
	const noteModal = () => (modalHadKey = !!$modalStore[0]);
	function onWindowKeydown(event) {
		if (!opened || modalHadKey || $modalStore[0] || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key !== "Escape") return;
		// The leave prompt: Esc keeps editing.
		if ($logbookStore.fix?.leaving) {
			event.preventDefault();
			logbookStore.keepFix();
			return;
		}
		if (event.target?.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor")) return;
		event.preventDefault();
		logbookStore.close();
	}

	// N by default (logbook.next-record); it waits while the leave prompt is up.
	function nextRecord() {
		if (!opened || $modalStore[0] || $logbookStore.fix?.leaving) return;
		logbookStore.openNext();
	}

	// newRecord does nothing while a modal is open.
	const newFinding = () => newRecord(modalStore, "finding");
	const newTestCase = () => newRecord(modalStore, "testCase");

	function openExport() {
		if ($modalStore[0] || empty) return;
		modalStore.trigger({ type: "component", component: "ExportReport", toggleAction: "logbook.export-report" });
	}

	const logbookMenu = [
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
		{ actionId: "logbook.export-report", icon: SquareArrowRightIcon, handler: openExport },
		{ actionId: "logbook.next-record", icon: ArrowRight, handler: nextRecord },
	];
	useMenuActions(logbookMenu);
</script>

<svelte:window on:keydown|capture={noteModal} on:keydown={onWindowKeydown} />

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
			onExport={openExport}
			exportDisabled={empty}
		/>
		<div class="min-h-0 flex-1 bg-surface-50 dark:bg-surface-900">
			{#if opened}
				<LogbookRecord
					store={logbookStore}
					kind={opened.kind}
					record={opened.record}
					focus={opened.focus}
					hasNext={!!next}
					{nextTitle}
					onBack={logbookStore.close}
					onNext={logbookStore.openNext}
					onEdit={editOpened}
					onDelete={deleteRecord}
					onOpen={openRecord}
				/>
			{:else}
				<LogbookSummary store={logbookStore} onOpen={openRecord} />
			{/if}
		</div>
	</section>
</div>
