<script>
	import {
		Accordion,
		AccordionItem,
		getDrawerStore,
		getModalStore,
		Tab,
		TabGroup,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import {
		BookCheck,
		ListTree,
		SettingsIcon,
		ShieldAlert,
		Search,
		Plus,
		SquareArrowRightIcon,
		ToggleLeftIcon,
		TrashIcon,
	} from "lucide-svelte";
	import { findingStore } from "../../stores/findingStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
	import { useMenuActions } from "../../lib/keybindings/app.js";
	import { logbookSearchInput } from "../../stores";
	import { logbookStore } from "../../stores/logbookStore.js";
	import { editRecord, newRecord } from "../../lib/logbook/recordEditor.js";

	const modalStore = getModalStore();
	const drawerStore = getDrawerStore();
	let accOpened = false;
	let tabSet = 0;

	function getScoreBadgeClass(severity) {
		switch (severity) {
			case "Critical":
				return "bg-red-600 text-white";
			case "High":
				return "bg-orange-500 text-white";
			case "Medium":
				return "bg-yellow-500 text-black";
			case "Low":
				return "bg-blue-500 text-white";
			case "Informational":
				return "bg-green-500 text-white";
			default:
				return "variant-soft";
		}
	}

	const openFindingModal = (finding) => editRecord(modalStore, "finding", finding.ID);
	const openTestCaseModal = (testCase) => editRecord(modalStore, "testCase", testCase.ID);

	function openExportDrawer() {
		if ($modalStore[0]) return;
		if (findings.length === 0 && testCases.length === 0) return;
		if (
			!$drawerStore ||
			Object.keys($drawerStore).length === 0 ||
			!$drawerStore.open
		)
			drawerStore.open({
				id: "report-export",
				position: "right",
				width: "w-full md:w-[50%]",
				height: "h-full",
				rounded: "rounded-none",
			});
		else if (
			$drawerStore.id === "report-export" &&
			$drawerStore.open
		)
			drawerStore.close();
	}

	$: testCases = $testCaseStore
		.filter((tc) => {
			if (!$logbookSearchInput) return true;
			const query = $logbookSearchInput.toLowerCase().trim();
			const titleMatch = (tc?.Title ?? "")
				.toLowerCase()
				.includes(query);
			const descMatch = (tc?.Description ?? "")
				.toLowerCase()
				.includes(query);
			const catMatch = (tc?.Category ?? "")
				.toLowerCase()
				.includes(query);
			const tagMatch = (tc?.Tags ?? []).some((tag) =>
				tag.toLowerCase().includes(query),
			);
			const noteMatch = (tc?.Note ?? "")
				.toLowerCase()
				.includes(query);

			return (
				titleMatch ||
				descMatch ||
				catMatch ||
				tagMatch ||
				noteMatch
			);
		})
		.sort((a, b) => {
			const titleA = (a?.Title ?? "").toString();
			const titleB = (b?.Title ?? "").toString();

			if (titleA !== titleB) {
				return titleA.localeCompare(titleB);
			}

			return 0;
		});
	$: findings = $findingStore
		.filter((fnd) => {
			if (!$logbookSearchInput) return true;

			const query = $logbookSearchInput.toLowerCase().trim();
			const titleMatch = (fnd?.Title ?? "")
				.toLowerCase()
				.includes(query);
			const severityMatch = (fnd?.Severity ?? "")
				.toLowerCase()
				.includes(query);
			return titleMatch || severityMatch;
		})
		.sort((a, b) => {
			const severityRank = {
				Critical: 5,
				High: 4,
				Medium: 3,
				Low: 2,
				Informational: 1,
			};
			const rankA = severityRank[a?.Severity] || 0;
			const rankB = severityRank[b?.Severity] || 0;

			if (rankA !== rankB) {
				return rankB - rankA;
			}

			const scoreA = Number(a?.CVSSScore) || 0;
			const scoreB = Number(b?.CVSSScore) || 0;

			return scoreB - scoreA;
		});
	let logbookMenu = [
		{
			actionId: "logbook.toggle-settings",
			icon: ToggleLeftIcon,
			handler: () => {
				if (!$modalStore[0]) {
					accOpened = !accOpened;
				}
			},
		},
		{
			actionId: "logbook.focus-search",
			icon: Search,
			handler: () => {
				if (!$modalStore[0]) {
					accOpened = !accOpened;
					setTimeout(() => {
						const searchBox =
							document.getElementById(
								"logbookSearch",
							);
						if (
							document.activeElement ===
							searchBox
						)
							searchBox.blur();
						else searchBox.focus();
					}, 10);
				}
			},
		},
		{
			actionId: "logbook.create-finding",
			icon: ShieldAlert,
			handler: () => {
				if (!$modalStore[0])
					newRecord(modalStore, "finding");
				else if (
					$modalStore[0].component ===
					"LogbookRecord"
				)
					logbookStore.requestClose();
			},
		},
		{
			actionId: "logbook.create-test-case",
			icon: BookCheck,
			handler: () => {
				if (!$modalStore[0])
					newRecord(modalStore, "testCase");
				else if (
					$modalStore[0].component ===
					"LogbookRecord"
				)
					logbookStore.requestClose();
			},
		},
		{
			actionId: "logbook.export-report",
			icon: SquareArrowRightIcon,
			handler: openExportDrawer,
		},
	];
	useMenuActions(logbookMenu);
</script>

<MarasiKeys menuOptions={logbookMenu} />
<Accordion rounded="none" padding="py-3 px-3" regionControl="text-sm font-bold" class="bg-surface-50 dark:bg-surface-900 text-surface-900-50-token">
	<AccordionItem bind:open={accOpened}>
		<svelte:fragment slot="lead"><SettingsIcon size="16" /></svelte:fragment>
		<svelte:fragment slot="summary"
			>Logbook Settings</svelte:fragment
		>
		<svelte:fragment slot="content">
			<div
				class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 p-2 text-sm"
			>
				<div
					class="input-group input-group-divider h-8 grid-cols-[auto_1fr_auto] w-full md:w-[400px]"
				>
					<div class="input-group-shim px-2">
						<Search size={14} />
					</div>
					<input
						id="logbookSearch"
						class="text-sm"
						type="search"
						placeholder={tabSet === 0
							? "Search test cases and findings..."
							: tabSet === 1
								? "Search findings..."
								: "Search test cases.."}
						bind:value={$logbookSearchInput}
					/>
				</div>

				<div
					class="flex items-center gap-3 w-full md:w-auto justify-between"
				>
					<TabGroup class="text-sm">
						<Tab
							bind:group={tabSet}
							name="combined"
							value={0}
							padding="px-3 py-1"
						>
							<div
								class="flex items-center gap-2"
							>
								<ListTree
									size={16}
								/>
								<span>All</span>
							</div>
						</Tab>
						<Tab
							bind:group={tabSet}
							name="findings"
							value={1}
							padding="px-3 py-1"
						>
							<div
								class="flex items-center gap-2"
							>
								<ShieldAlert
									size={16}
								/>
								<span
									>Findings</span
								>
							</div>
						</Tab>
						<Tab
							bind:group={tabSet}
							name="testcases"
							value={2}
							padding="px-3 py-1"
						>
							<div
								class="flex items-center gap-2"
							>
								<BookCheck
									size={16}
								/>
								<span
									>Test
									Cases</span
								>
							</div>
						</Tab>
					</TabGroup>

					<div class="flex gap-2">
						<button
							on:click={() => {
								if (
									!$modalStore[0]
								)
									newRecord(modalStore, "finding");
								else if (
									$modalStore[0]
										.component ===
									"LogbookRecord"
								)
									logbookStore.requestClose();
							}}
							class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
						>
							<Plus
								size={14}
								class="mr-1"
							/> Finding
						</button>
						<button
							on:click={() => {
								if (
									!$modalStore[0]
								)
									newRecord(modalStore, "testCase");
								else if (
									$modalStore[0]
										.component ===
									"LogbookRecord"
								)
									logbookStore.requestClose();
							}}
							class="btn btn-sm {$modeCurrent ? 'variant-ghost-tertiary ring-0 shadow-none' : 'variant-filled-tertiary'}"
						>
							<Plus
								size={14}
								class="mr-1"
							/> Test Case
						</button>
						<button
							class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
							disabled={findings.length ===
								0 &&
								testCases.length ===
									0}
							on:click={openExportDrawer}
						>
							<SquareArrowRightIcon
								size={14}
								class="mr-1"
							/> Export Report
						</button>
					</div>
				</div>
			</div>
		</svelte:fragment>
	</AccordionItem>
</Accordion>

<div class="container p-4 text-sm">
	{#if (tabSet === 0 || tabSet === 1) && findings.length > 0}
		{#if tabSet === 0}
			<h3 class="text-sm font-bold mb-3 flex items-center gap-2">
				<ShieldAlert
					size={16}
					class="text-primary-500"
				/>
				Findings ({findings.length})
			</h3>
		{/if}

		<div
			class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mb-4"
		>
			{#each findings as finding (finding.ID)}
				<!--svelte-ignore a11y-click-events-have-key-events-->
				<!--svelte-ignore a11y-no-static-element-interactions-->
				<div
					class="card group relative p-3 cursor-pointer flex flex-col justify-between gap-3 border-l-4 border-surface-500/30 transition-all bg-surface-50 dark:bg-surface-800 {$modeCurrent ? 'hover:border-primary-500/20' : 'hover:border-primary-500'}"
					on:click={() =>
						openFindingModal(
							finding,
							false,
						)}
				>
					<span
						class="badge-icon absolute -top-2 -right-2 z-20 w-8 h-8 cursor-pointer
                 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg
                 {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none hover:variant-ghost-error' : 'variant-filled-primary hover:variant-filled-error'}"
						on:click|stopPropagation={() => {
							modalStore.trigger({
								type: "confirm",
								title: "Delete Finding",
								body: "Are you sure you want to delete this finding?",
								response: (
									r,
								) => {
									if (r)
										findingStore.delete(
											finding.ID,
										);
								},
							});
						}}
					>
						<TrashIcon size="14" />
					</span>
					<header class="card-header">
						<div
							class="flex justify-between items-start mb-2"
						>
							<div
								class="flex items-center gap-2"
							>
								<span
									class="badge text-[10px] {getScoreBadgeClass(
										finding?.Severity,
									)} font-bold"
								>
									{finding?.Severity ||
										"Draft"}
								</span>
							</div>
							<span
								class="text-xs font-mono opacity-60 bg-surface-200 px-2 py-1 text-surface-900 dark:bg-surface-900 dark:text-surface-50"
							>
								CVSS: {finding?.CVSSScore ||
									"N/A"}
							</span>
						</div>
						<h4
							class="text-sm font-bold line-clamp-2"
						>
							{finding?.Title}
						</h4>
					</header>
					<section class="p-2">
						<p
							class="text-xs opacity-60 line-clamp-2"
						>
							{finding?.WriteUp}
						</p>
					</section>
					<footer class="card-footer">
						<div
							class="grid grid-cols-2 gap-2 text-xs font-mono mt-auto pt-3 border-t border-surface-500/30"
						>
							<div
								class="flex items-center gap-1 opacity-70"
							>
								<span
									class="font-bold"
									>Requests:</span
								>
								{finding
									?.Requests
									?.length ||
									0}
							</div>
							<div
								class="flex items-center gap-1 {finding?.TestCaseID
									? 'text-tertiary-500'
									: 'opacity-50'}"
							>
								<span
									class="font-bold"
									>Test
									Case:</span
								>
								{finding?.TestCaseID
									? "Yes"
									: "No"}
							</div>
							<div
								class="flex items-center gap-1 opacity-70"
							>
								<span
									class="font-bold"
									>Artifacts:</span
								>
								{finding
									?.Artifacts
									?.length ||
									0}
							</div>
							<div
								class="flex items-center gap-1 {finding?.TreatmentPlan &&
								typeof finding.TreatmentPlan ===
									'string' &&
								finding.TreatmentPlan.trim()
									? 'text-success-500'
									: 'opacity-50'}"
							>
								<span
									class="font-bold"
									>Treatment
									Plan:</span
								>
								{finding?.TreatmentPlan &&
								typeof finding.TreatmentPlan ===
									"string" &&
								finding.TreatmentPlan.trim()
									? "Yes"
									: "No"}
							</div>
						</div>
					</footer>
				</div>
			{/each}
		</div>
	{/if}

	{#if (tabSet === 0 || tabSet === 2) && testCases.length > 0}
		{#if tabSet === 0}
			<h3 class="text-sm font-bold mb-3 flex items-center gap-2">
				<BookCheck
					size={16}
					class="text-tertiary-500"
				/>
				Test Cases ({testCases.length})
			</h3>
		{/if}
		<div
			class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mb-4"
		>
			{#each testCases as testCase (testCase.ID)}
				<!--svelte-ignore a11y-click-events-have-key-events-->
				<!--svelte-ignore a11y-no-static-element-interactions-->
				<div
					class="card group relative p-3 cursor-pointer flex flex-col justify-between gap-3 border-l-4 border-surface-500/30 transition-all bg-surface-50 dark:bg-surface-800 {$modeCurrent ? 'hover:border-tertiary-500/20' : 'hover:border-tertiary-500'}"
					on:click={() =>
						openTestCaseModal(
							testCase,
							false,
						)}
				>
					<span
						class="badge-icon absolute -top-2 -right-2 z-20 w-8 h-8 cursor-pointer
                 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg
                 {$modeCurrent ? 'variant-ghost-tertiary ring-0 shadow-none hover:variant-ghost-warning' : 'variant-filled-tertiary hover:variant-filled-warning'}"
						on:click|stopPropagation={() => {
							modalStore.trigger({
								type: "confirm",
								title: "Delete Test Case",
								body: "Are you sure you want to delete this test case?",
								response: (
									r,
								) => {
									if (r)
										testCaseStore.delete(
											testCase.ID,
										);
								},
							});
						}}
					>
						<TrashIcon size="14" />
					</span>
					<header class="card-header">
						<div
							class="flex flex-wrap justify-between items-start gap-x-4 gap-y-2 mb-3"
						>
							<div class="max-w-full">
								{#if testCase?.Category}
									<span
										class="badge text-[10px] variant-soft-tertiary font-bold h-auto whitespace-normal text-left"
									>
										{testCase.Category}
									</span>
								{:else}
									<span
										class="badge text-[10px] variant-soft font-bold"
										>Uncategorized</span
									>
								{/if}
							</div>

							<div
								class="flex flex-wrap gap-1"
							>
								{#if testCase?.Tags?.length > 0}
									{#each testCase.Tags.slice(0, 2) as tag}
										<span
											class="text-xs font-mono opacity-60 bg-surface-200 text-surface-900 dark:bg-surface-900 dark:text-surface-50 px-2 py-1 rounded-token whitespace-nowrap"
										>
											{tag}
										</span>
									{/each}
									{#if testCase.Tags.length > 2}
										<span
											class="text-xs font-mono opacity-60 bg-surface-200 text-surface-900 dark:bg-surface-900 dark:text-surface-50 px-2 py-1 rounded-token"
											>...</span
										>
									{/if}
								{:else}
									<span
										class="text-xs font-mono opacity-60 bg-surface-200 text-surface-900 dark:bg-surface-900 dark:text-surface-50 px-2 py-1 rounded-token whitespace-nowrap"
										>Untagged</span
									>
								{/if}
							</div>
						</div>

						<h4
							class="text-sm font-bold line-clamp-2"
						>
							{testCase?.Title}
						</h4>
					</header>
					<section class="p-2">
						<p
							class="text-xs opacity-60 line-clamp-2"
						>
							{testCase?.Note}
						</p>
					</section>
					<footer class="card-footer">
						<div
							class="grid grid-cols-2 gap-2 text-xs font-mono mt-auto pt-3 border-t border-surface-500/30"
						>
							<div
								class="flex items-center gap-1 opacity-70"
							>
								<span
									class="font-bold"
									>Requests:</span
								>
								{testCase
									?.Requests
									?.length ||
									0}
							</div>
							<div
								class="flex items-center gap-1 {findings.filter(
									(f) =>
										f.TestCaseID ===
										testCase.ID,
								).length > 0
									? 'text-tertiary-500'
									: 'opacity-50'}"
							>
								<span
									class="font-bold"
									>Findings:</span
								>
								{findings.filter(
									(f) =>
										f.TestCaseID ===
										testCase.ID,
								).length}
							</div>
							<div
								class="flex items-center gap-1 opacity-70"
							>
								<span
									class="font-bold"
									>Artifacts:</span
								>
								{testCase
									?.Artifacts
									?.length ||
									0}
							</div>
						</div>
					</footer>
				</div>
			{/each}
		</div>
	{/if}

	{#if tabSet === 0 && findings.length === 0 && testCases.length === 0}
		<div
			class="py-20 text-center opacity-50 flex flex-col items-center"
		>
			<ListTree size={48} class="mb-4 opacity-50" />
			<p>No findings or test cases match your criteria.</p>
		</div>
	{:else if tabSet === 1 && findings.length === 0}
		<div
			class="py-20 text-center opacity-50 flex flex-col items-center"
		>
			<ShieldAlert size={48} class="mb-4 opacity-50" />
			<p>No findings match your criteria.</p>
		</div>
	{:else if tabSet === 2 && testCases.length === 0}
		<div
			class="py-20 text-center opacity-50 flex flex-col items-center"
		>
			<BookCheck size={48} class="mb-4 opacity-50" />
			<p>No test cases match your criteria.</p>
		</div>
	{/if}
</div>
