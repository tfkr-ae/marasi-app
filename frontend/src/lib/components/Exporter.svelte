<script>
	import { FileText } from "lucide-svelte";
	import {
		ListTemplates,
		ExportReport,
	} from "../../lib/wailsjs/go/main/App";
	import { getDrawerStore, getToastStore } from "@skeletonlabs/skeleton";
	import { onMount } from "svelte";
	import { reportMetadata } from "../../stores";
	import ProgressRadial from "../extensions/components/ProgressRadial.svelte";

	const toastStore = getToastStore();
	const drawerStore = getDrawerStore();
	let templates = [];
	let loadingTemplates = true;
	let exporting = false;
	let selectedTemplate;
	async function loadTemplates() {
		loadingTemplates = true;
		try {
			templates = (await ListTemplates()) || [];
			if (templates.length > 0) {
				selectedTemplate =
					selectedTemplate || templates[0];
			}
		} catch (err) {
			toastStore.trigger({
				message: "Failed to load report templates",
				background: "variant-filled-error",
			});
		} finally {
			loadingTemplates = false;
		}
	}

	async function exportReport() {
		exporting = true;
		const payload = {
			...$reportMetadata,
			start: `${$reportMetadata.start}T00:00:00Z`,
			end: `${$reportMetadata.end}T00:00:00Z`,
			created_at: new Date().toISOString(),
		};
		try {
			const wasSaved = await ExportReport(
				selectedTemplate,
				payload,
			);
			if (wasSaved) {
				toastStore.trigger({
					message: "Report saved",
					background: "variant-filled-success",
				});
				drawerStore.close();
			}
		} catch (err) {
			toastStore.trigger({
				message: err,
				background: "variant-filled-error",
			});
		} finally {
			exporting = false;
		}
	}
	onMount(() => {
		loadTemplates();
	});
</script>

<div
	class="flex h-full flex-col bg-surface-100-800-token text-surface-900-50-token"
>
	<header
		class="flex items-center justify-between gap-4 border-b border-surface-500/20 px-5 py-4"
	>
		<div class="flex min-w-0 items-center gap-3">
			<FileText size={20} class="text-primary-500 shrink-0" />
			<h2 class="truncate text-lg font-bold">
				Export Report
			</h2>
		</div>
	</header>

	<div class="flex-1 space-y-5 overflow-y-auto px-5 py-5">
		<div class="space-y-1.5 h-full flex flex-col">
			<label class="label">
				<span>Templates</span>
				<select
					class="select"
					bind:value={selectedTemplate}
					disabled={loadingTemplates ||
						templates.length === 0}
				>
					{#each templates as template}
						<option value={template}>
							{template}
						</option>
					{/each}
				</select>
			</label>
			<label class="label">
				<span>Title</span>
				<input
					class="input"
					type="text"
					bind:value={$reportMetadata.title}
				/>
			</label>
			<label class="label">
				<span>Client</span>
				<input
					class="input"
					type="text"
					bind:value={$reportMetadata.client}
				/>
			</label>
			<label class="label">
				<span>Assessment Type</span>
				<input
					class="input"
					type="text"
					bind:value={$reportMetadata.type}
				/>
			</label>
			<label class="label">
				<span>Scope</span>
				<input
					class="input"
					type="text"
					bind:value={$reportMetadata.scope}
				/>
			</label>
			<label class="label">
				<span>Assessor</span>
				<input
					class="input"
					type="text"
					bind:value={$reportMetadata.assessor}
				/>
			</label>
			<label class="label">
				<span>Start</span>
				<input
					class="input"
					type="date"
					bind:value={$reportMetadata.start}
				/>
			</label>

			<label class="label">
				<span>End</span>
				<input
					class="input"
					type="date"
					bind:value={$reportMetadata.end}
				/>
			</label>
			<label class="label">
				<span>Report Options</span>

				<label class="flex items-center gap-2 mt-1">
					<input
						class="checkbox"
						type="checkbox"
						bind:checked={
							$reportMetadata.is_draft
						}
					/>
					<span>Mark as Draft</span>
				</label>
				<label class="flex items-center gap-2 mt-1">
					<input
						class="checkbox"
						type="checkbox"
						checked={$reportMetadata.truncate_length >
							0}
						on:change={(e) => {
							if (
								e.currentTarget
									.checked
							) {
								if (
									!$reportMetadata.truncate_length
								) {
									$reportMetadata.truncate_length = 1000;
								}
							} else {
								$reportMetadata.truncate_length = 0;
							}
						}}
					/>
					<span>Truncate Bodies</span>
				</label>
				<div class="ml-6 mt-1 min-h-[42px]">
					{#if $reportMetadata.truncate_length > 0}
						<div
							class="flex items-center gap-2"
						>
							<input
								class="input w-32 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								type="number"
								min="100"
								bind:value={
									$reportMetadata.truncate_length
								}
							/>
							<span class="text-xs"
								>bytes</span
							>
						</div>
					{/if}
				</div>
			</label>
			<div class="flex justify-end mt-3 py-1">
				<button
					type="button"
					class="btn variant-filled-primary w-fit"
					disabled={exporting}
					on:click={() => exportReport()}
				>
					{#if exporting}
						<ProgressRadial
							width="w-5"
							stroke={100}
							meter="stroke-surface-50"
							track="stroke-primary-400"
						/>
						<span>Exporting...</span>
					{:else}
						<span>Export</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>
