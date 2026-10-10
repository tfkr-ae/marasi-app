<script>
	import {
		StartBrowser,
		GetChromeProfiles,
	} from "../lib/wailsjs/go/main/App";
	import { ChromeIcon } from "svelte-feather-icons";
	import LogTable from "../lib/components/LogTable.svelte";
	import Dashboard from "../lib/components/Dashboard.svelte";
	import {
		getModalStore,
		getToastStore,
		popup,
		modeCurrent,
	} from "@skeletonlabs/skeleton";
	import { ChevronDown, Download, FolderOpen } from "lucide-svelte";
	import { listener } from "../stores";
	import {
		downloadCertificate,
		listenerModal,
		projectModal,
	} from "../lib/globalActions.js";
	import { onMount } from "svelte";
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	let chromeProfiles = [];
	const chromeProfilesPopup = {
		event: "click",
		target: "chromeProfilesPopup",
		placement: "bottom-end",
	};

	onMount(() => {
		GetChromeProfiles().then((profiles) => {
			chromeProfiles = profiles;
		});
	});
</script>

<div class="content">
	<div class="no-select dashboard-content">
		<div class="container mx-auto p-8 space-y-8">
			<div
				class="header flex justify-between items-center mb-8"
			>
				<div class="btn-group {$modeCurrent ? 'light-ghost-group' : 'variant-filled'}">
					<button
						type="button"
						class="btn items-center flex {$modeCurrent ? 'variant-ghost border-0 ring-0' : 'variant-filled'}"
						on:click={() => {
							if (!$modalStore[0]) modalStore.trigger(listenerModal(toastStore));
						}}
					>
						<span
							>{$listener.address +
								":" +
								$listener.port}</span
						>
						<span
							class={"flex w-3 h-3 me-3 rounded-full " +
								($listener.status
									? "bg-success-500"
									: "bg-primary-500")}
						></span>
					</button>
					<button
						type="button"
						class="btn flex items-center {$modeCurrent ? 'variant-ghost border-0 ring-0' : 'variant-filled'}"
						on:click={() => {
							if (!$modalStore[0]) modalStore.trigger(projectModal(toastStore));
						}}
					>
						<span class="mr-2"
							><FolderOpen /></span
						>
						<span>Open Project</span>
					</button>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="btn {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
						on:click={() => downloadCertificate(toastStore)}
					>
						<span
							><Download
								size={20}
							/></span
						>
						<span>Download Certificate</span
						>
					</button>

					<div class="relative w-fit">
						<div
							class="flex w-full overflow-hidden rounded-container-token"
						>
							<button
								type="button"
								class="btn flex-1 {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
								class:rounded-none={chromeProfiles.length >
									0}
								on:click={() =>
									StartBrowser(
										"",
									)}
							>
								<span
									><ChromeIcon
									/></span
								>
								<span
									>Start
									Chrome</span
								>
							</button>

							{#if chromeProfiles.length > 0}
								<button
									type="button"
									class="btn rounded-none px-3 {$modeCurrent ? 'variant-ghost-primary border-0 ring-0' : 'variant-filled-primary'}"
									use:popup={chromeProfilesPopup}
									aria-label="Start Chrome with custom profile"
									title="Start with custom profile"
								>
									<span
										><ChevronDown
										/></span
									>
								</button>
							{/if}
						</div>

						{#if chromeProfiles.length >= 0}
							<div
								class="card z-10 w-full bg-surface-100-800-token shadow-xl"
								data-popup="chromeProfilesPopup"
							>
								{#each chromeProfiles as profile}
									<button
										type="button"
										class="w-full p-3 text-left text-sm hover:variant-soft-primary focus:variant-soft-primary"
										on:click={() =>
											StartBrowser(
												profile,
											)}
									>
										{profile}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
			<Dashboard />
		</div>
	</div>

	<div class="log-table-container">
		<LogTable />
	</div>
</div>

<style>
	:global(.light-ghost-group .btn:hover) {
		background-color: rgb(var(--color-surface-400) / 0.25) !important;
	}

	/* Container for the page content */
	.content {
		display: flex;
		flex-direction: column;
		height: 100vh; /* Use fixed height instead of min-height */
		overflow: hidden; /* Prevent overall page scrolling */
		position: relative; /* Create positioning context */
	}

	/* Main content area - fixed, non-scrollable */
	.dashboard-content {
		flex: 1 0 auto;
		overflow-y: hidden; /* Prevent dashboard content from scrolling */
		max-height: calc(
			100vh - 30vh
		); /* Ensure it doesn't overflow available space */
		padding-bottom: 1rem;
	}

	/* Log table container - the only scrollable part */
	.log-table-container {
		flex: 0 0 50vh; /* Fixed height */
		height: 50vh;
		border-top: 2px solid rgb(var(--color-surface-300));
		background-color: rgb(var(--color-surface-50));
		overflow-y: auto; /* Enable scrolling only for log table */
		position: relative; /* Create stacking context */
		bottom: 0; /* Position at bottom */
		width: 100%;
		scrollbar-color: rgb(var(--color-surface-400))
			rgb(var(--color-surface-100));
	}

	:global(.dark) .log-table-container {
		border-top-color: rgb(var(--color-surface-500));
		background-color: rgb(var(--color-surface-900));
		scrollbar-color: rgb(var(--color-surface-600))
			rgb(var(--color-surface-800));
	}

	/* Responsive adjustments for small screens */
	@media (max-height: 700px) {
		.dashboard-content {
			max-height: calc(100vh - 25vh);
		}

		.log-table-container {
			flex: 0 0 25vh;
			height: 25vh;
		}
	}

	@media (max-height: 500px) {
		.dashboard-content {
			max-height: calc(100vh - 20vh);
		}

		.log-table-container {
			flex: 0 0 20vh;
			height: 20vh;
		}
	}
</style>
