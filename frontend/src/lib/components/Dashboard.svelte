<script>
	import { activeProject } from "../../stores";
	import { CountNotes, GetScopeRules } from "../wailsjs/go/main/App";
	import {
		Edit2Icon,
		SendIcon,
		FlagIcon,
		ActivityIcon,
		CheckCircleIcon,
		XCircleIcon,
	} from "svelte-feather-icons";
	import {
		BookCheck,
		Shield,
		ShieldAlert,
		ShieldOff,
	} from "lucide-svelte";
	import { findingStore } from "../../stores/findingStore";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { groupBuilding, jobsStore } from "../../stores/jobsStore";

	// Dashboard statistics
	let totalRequests = 0;
	let notes = 0;
	let launchpads = 0;
	let intercepted = 0;
	// False while Marasi's intercepted_count job is still counting older
	// pairs after an upgrade: the figure is a floor until it finishes.
	let interceptedComplete = true;

	// Scope statistics
	let defaultAllow = true;
	let includeRulesCount = 0;
	let excludeRulesCount = 0;

	$: testCasesCount = $testCaseStore.length;
	$: findingsCount = $findingStore.length;
	$: criticalCount = $findingStore.filter(
		(f) => f.Severity === "Critical",
	).length;
	$: highCount = $findingStore.filter(
		(f) => f.Severity === "High",
	).length;

	// Refreshes on mount and on each project switch. (A second refresh in
	// onMount doubled CountNotes, which holds up every other call to Marasi
	// while it counts a large project.)
	$: if ($activeProject) {
		refreshDashboard();
	}

	// Figures use the reader's locale ("100,000"), as the Ledger's counts do.
	// While a figure is read its card shows a ghost bar instead; a newer
	// refresh (a project switch) wins over a slower older one.
	let countsLoading = true;
	let scopeLoading = true;
	let refreshes = 0;
	const ghost =
		"dashboard-ghost inline-block h-7 w-16 animate-pulse rounded-sm bg-surface-300 align-middle dark:bg-surface-600";

	// Once the job finishes, read the exact count.
	$: interceptedCounting = groupBuilding($jobsStore, "intercepted");
	let wasCounting = false;
	$: {
		if (wasCounting && !interceptedCounting && !interceptedComplete) refreshDashboard();
		wasCounting = interceptedCounting;
	}

	// Refresh dashboard data
	function refreshDashboard() {
		const run = ++refreshes;
		countsLoading = true;
		scopeLoading = true;
		CountNotes()
			.then((dashboard) => {
				if (run !== refreshes) return;
				totalRequests = dashboard.Requests;
				notes = dashboard.Notes;
				launchpads = dashboard.Launchpads;
				intercepted = dashboard.Interceptions || 0;
				interceptedComplete = dashboard.InterceptionsComplete;
				if (!interceptedComplete) jobsStore.watch("intercepted");
			})
			.catch((err) => console.error("Counting the dashboard failed:", err))
			.finally(() => {
				if (run === refreshes) countsLoading = false;
			});

		GetScopeRules()
			.then((scopeData) => {
				if (run !== refreshes) return;
				defaultAllow = scopeData.defaultAllow;
				includeRulesCount = scopeData.includeRules.length;
				excludeRulesCount = scopeData.excludeRules.length;
			})
			.catch((err) => console.error("Reading the scope rules failed:", err))
			.finally(() => {
				if (run === refreshes) scopeLoading = false;
			});
	}

</script>

<div class="no-select p-4">
	<h2 class="text-base font-bold mb-4">
		{$activeProject} Project Dashboard
	</h2>

	<!-- Main metrics cards -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
		<!-- Total Requests -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-primary-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-primary-700)); color: rgb(var(--color-primary-200))"
					>
						<ActivityIcon size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Total Requests
						</p>
						<p class="text-xl font-bold">
							{#if countsLoading}<span class={ghost}></span>{:else}{totalRequests.toLocaleString()}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Notes -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-tertiary-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-tertiary-700)); color: rgb(var(--color-tertiary-200))"
					>
						<Edit2Icon size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Notes
						</p>
						<p class="text-xl font-bold">
							{#if countsLoading}<span class={ghost}></span>{:else}{notes.toLocaleString()}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Launchpads -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-surface-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-surface-700)); color: rgb(var(--color-surface-300))"
					>
						<SendIcon size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Launchpads
						</p>
						<p class="text-xl font-bold">
							{#if countsLoading}<span class={ghost}></span>{:else}{launchpads.toLocaleString()}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Intercepted -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-warning-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-warning-700)); color: rgb(var(--color-warning-200))"
					>
						<FlagIcon size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Intercepted
						</p>
						<p class="text-xl font-bold">
							{#if countsLoading}<span class={ghost}></span>{:else}{intercepted.toLocaleString()}{#if !interceptedComplete}<span
										class="dashboard-counting ml-2 align-middle text-xs font-normal opacity-60"
										title="Marasi is still counting intercepted requests from before this version"
										>counting…</span
									>{/if}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<h2 class="text-sm font-bold mb-3">Reporting</h2>
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-tertiary-500))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-tertiary-700)); color: rgb(var(--color-tertiary-100))"
					>
						<BookCheck size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Test Cases
						</p>
						<p class="text-xl font-bold">
							{testCasesCount.toLocaleString()}
						</p>
					</div>
				</div>
			</div>
		</div>

		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-primary-500))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-primary-700)); color: rgb(var(--color-primary-100))"
					>
						<ShieldAlert size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Findings
						</p>
						<p class="text-xl font-bold">
							{findingsCount.toLocaleString()}
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<h2 class="text-sm font-bold mb-3">Scope</h2>
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
		<!-- Default Policy -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-success-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-success-700)); color: rgb(var(--color-success-200))"
					>
						{#if !defaultAllow}
							<Shield size="16" />
						{:else}
							<ShieldOff size="16" />
						{/if}
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Default Policy
						</p>
						<p class="text-xl font-bold">
							{#if scopeLoading}<span class={ghost}></span>{:else}{defaultAllow
									? "Allow"
									: "Deny"}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Include Rules -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-secondary-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-secondary-700)); color: rgb(var(--color-surface-800))"
					>
						<CheckCircleIcon size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Include Rules
						</p>
						<p class="text-xl font-bold">
							{#if scopeLoading}<span class={ghost}></span>{:else}{includeRulesCount.toLocaleString()}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Exclude Rules -->
		<div
			class="card bg-surface-100-500-token text-surface-900-50-token border-l-4"
			style="border-color: rgb(var(--color-primary-700))"
		>
			<div class="card-body p-3">
				<div class="flex items-center">
					<div
						class="rounded-full p-2"
						style="background-color: rgb(var(--color-primary-700)); color: rgb(var(--color-error-200))"
					>
						<XCircleIcon size="16" />
					</div>
					<div class="ml-3">
						<p class="text-xs opacity-70">
							Exclude Rules
						</p>
						<p class="text-xl font-bold">
							{#if scopeLoading}<span class={ghost}></span>{:else}{excludeRulesCount.toLocaleString()}{/if}
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
