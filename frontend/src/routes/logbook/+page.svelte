<script>
	import {
		Accordion,
		AccordionItem,
		getDrawerStore,
		getModalStore,
		Tab,
		TabGroup,
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
	import { logbookSearchInput } from "../../stores";

	const modalStore = getModalStore();
	const drawerStore = getDrawerStore();
	let accOpened = false;
	let tabSet = 0;
	let menu = [];

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

	function openFindingModal(finding, isNew) {
		if (!$modalStore[0]) {
			modalStore.trigger({
				type: "component",
				component: "Finding",
				toggleShortcut: { key: "f", shiftKey: true },
				meta: { finding: finding, isNew: isNew },
			});
		}
	}

	function openTestCaseModal(testCase, isNew) {
		if (!$modalStore[0]) {
			modalStore.trigger({
				type: "component",
				component: "TestCase",
				toggleShortcut: { key: "t", shiftKey: true },
				meta: { testCase: testCase, isNew: isNew },
			});
		}
	}

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
			name: "Toggle Logbook Settings",
			subtitle: "Toggle Settings Accordian",
			keywords: "settings, toggle",
			icon: ToggleLeftIcon,
			action: {
				handler: () => {
					if (!$modalStore[0]) {
						accOpened = !accOpened;
					}
				},
				options: { scope: "logbook", single: true },
				keys: ["⌘+P", "ctrl+P"],
			},
		},
		{
			name: "Search Logbook",
			subtitle: "Jump to search input",
			keywords: "search",
			icon: Search,
			action: {
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
				options: { scope: "logbook", single: true },
				keys: ["⌘+⇧+S", "ctrl+⇧+S"],
			},
		},
		{
			name: "Create Finding",
			subtitle: "Create a new draft finding",
			keywords: "create, new, finding",
			icon: ShieldAlert,
			action: {
				handler: () => {
					if (!$modalStore[0])
						findingStore
							.create([])
							.then((finding) =>
								openFindingModal(
									finding,
									true,
								),
							);
					else if (
						$modalStore[0].component ===
						"Finding"
					)
						modalStore.close();
				},
				options: { scope: "logbook", single: true },
				keys: ["⌘+⇧+F", "ctrl+⇧+F"],
			},
		},
		{
			name: "Create Test Case",
			subtitle: "Draft a new blank test case",
			keywords: "create, new, test, case",
			icon: BookCheck,
			action: {
				handler: () => {
					if (!$modalStore[0])
						testCaseStore
							.create([])
							.then((testCase) =>
								openTestCaseModal(
									testCase,
									true,
								),
							);
					else if (
						$modalStore[0].component ===
						"TestCase"
					)
						modalStore.close();
				},
				options: { scope: "logbook", single: true },
				keys: ["⌘+⇧+T", "ctrl+⇧+T"],
			},
		},
		{
			name: "Export Report",
			subtitle: "Create a report from logbook",
			keywords: "report, template, findings",
			icon: SquareArrowRightIcon,
			action: {
				handler: openExportDrawer,
				options: { scope: "logbook", single: true },
				keys: ["⌘+⇧+E", "ctrl+⇧+E"],
			},
		},
	];
</script>

<MarasiKeys bind:this={menu} scope="logbook" menuOptions={logbookMenu} />
<Accordion rounded="none">
	<AccordionItem bind:open={accOpened}>
		<svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
		<svelte:fragment slot="summary"
			>Logbook Settings</svelte:fragment
		>
		<svelte:fragment slot="content">
			<div
				class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-2"
			>
				<div
					class="input-group input-group-divider grid-cols-[auto_1fr_auto] w-full md:w-[400px]"
				>
					<div class="input-group-shim">
						<Search size={16} />
					</div>
					<input
						id="logbookSearch"
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
					class="flex items-center gap-4 w-full md:w-auto justify-between"
				>
					<TabGroup>
						<Tab
							bind:group={tabSet}
							name="combined"
							value={0}
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
									findingStore
										.create(
											[],
										)
										.then(
											(
												finding,
											) =>
												openFindingModal(
													finding,
													true,
												),
										);
								else if (
									$modalStore[0]
										.component ===
									"Finding"
								)
									modalStore.close();
							}}
							class="btn btn-sm variant-filled-primary"
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
									testCaseStore
										.create(
											[],
										)
										.then(
											(
												testCase,
											) =>
												openTestCaseModal(
													testCase,
													true,
												),
										);
								else if (
									$modalStore[0]
										.component ===
									"TestCase"
								)
									modalStore.close();
							}}
							class="btn btn-sm variant-filled-tertiary"
						>
							<Plus
								size={14}
								class="mr-1"
							/> Test Case
						</button>
						<button
							class="btn btn-sm variant-filled-primary"
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

<div class="container p-4">
	{#if (tabSet === 0 || tabSet === 1) && findings.length > 0}
		{#if tabSet === 0}
			<h3 class="h3 font-bold mb-4 flex items-center gap-2">
				<ShieldAlert
					size={20}
					class="text-primary-500"
				/>
				Findings ({findings.length})
			</h3>
		{/if}

		<div
			class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 mb-8"
		>
			{#each findings as finding (finding.ID)}
				<!--svelte-ignore a11y-click-events-have-key-events-->
				<!--svelte-ignore a11y-no-static-element-interactions-->
				<div
					class="card group relative p-4 cursor-pointer flex flex-col justify-between gap-4 border-l-4 border-surface-500/30 transition-all hover:border-primary-500 bg-surface-100-800-token"
					on:click={() =>
						openFindingModal(
							finding,
							false,
						)}
				>
					<span
						class="badge-icon variant-filled-primary absolute -top-2 -right-2 z-20 w-8 h-8 cursor-pointer
                 opacity-0 group-hover:opacity-100 transition-all duration-200
                 hover:variant-filled-error shadow-lg"
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
									class="badge {getScoreBadgeClass(
										finding?.Severity,
									)} font-bold"
								>
									{finding?.Severity ||
										"Draft"}
								</span>
							</div>
							<span
								class="text-xs font-mono opacity-60 bg-surface-900 px-2 py-1"
							>
								CVSS: {finding?.CVSSScore ||
									"N/A"}
							</span>
						</div>
						<h4
							class="h4 font-bold line-clamp-2"
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
							class="grid grid-cols-2 gap-2 text-xs font-mono mt-auto pt-4 border-t border-surface-500/30"
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
			<h3 class="h3 font-bold mb-4 flex items-center gap-2">
				<BookCheck
					size={20}
					class="text-tertiary-500"
				/>
				Test Cases ({testCases.length})
			</h3>
		{/if}
		<div
			class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 mb-8"
		>
			{#each testCases as testCase (testCase.ID)}
				<!--svelte-ignore a11y-click-events-have-key-events-->
				<!--svelte-ignore a11y-no-static-element-interactions-->
				<div
					class="card group relative p-4 cursor-pointer flex flex-col justify-between gap-4 border-l-4 border-surface-500/30 transition-all hover:border-tertiary-500 bg-surface-100-800-token"
					on:click={() =>
						openTestCaseModal(
							testCase,
							false,
						)}
				>
					<span
						class="badge-icon variant-filled-tertiary absolute -top-2 -right-2 z-20 w-8 h-8 cursor-pointer
                 opacity-0 group-hover:opacity-100 transition-all duration-200
                 hover:variant-filled-warning shadow-lg"
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
										class="badge variant-soft-tertiary font-bold h-auto whitespace-normal text-left"
									>
										{testCase.Category}
									</span>
								{:else}
									<span
										class="badge variant-soft font-bold"
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
											class="text-xs font-mono opacity-60 bg-surface-900 px-2 py-1 rounded-token whitespace-nowrap"
										>
											{tag}
										</span>
									{/each}
									{#if testCase.Tags.length > 2}
										<span
											class="text-xs font-mono opacity-60 bg-surface-900 px-2 py-1 rounded-token"
											>...</span
										>
									{/if}
								{:else}
									<span
										class="text-xs font-mono opacity-60 bg-surface-900 px-2 py-1 rounded-token whitespace-nowrap"
										>Untagged</span
									>
								{/if}
							</div>
						</div>

						<h4
							class="h4 font-bold line-clamp-2"
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
							class="grid grid-cols-2 gap-2 text-xs font-mono mt-auto pt-4 border-t border-surface-500/30"
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
