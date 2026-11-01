<script>
	// The export modal. On the left, the template (upload one from this
	// machine; Delete and Restore default ask once inline), the report
	// details and the options as switch rows; on the right, the review of
	// what the report holds. Export calls ExportReport with reportMetadata,
	// whose custom_properties.include_test_cases decides whether test cases
	// are listed, and saves the report on this machine. Clicking a gap closes
	// the modal and opens that record at the missing item.
	import { getModalStore, getToastStore, modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { onMount } from "svelte";
	import { FileText, RotateCcw, SquareArrowRight, Trash2, Upload, X } from "lucide-svelte";
	import { ExportReport } from "../bindings/App";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts.js";
	import { reportMetadata } from "../../stores";
	import { logbookStore } from "../../stores/logbookStore";
	import { reportTemplateStore } from "../../stores/reportTemplateStore";
	import ReportReview from "./ReportReview.svelte";

	export let parent = undefined;

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const TRUNCATE_DEFAULT = 1000;

	let confirmRestore = false;
	let confirmDelete = false;
	// The template change in flight: "upload", "delete" or "restore".
	let changing = "";
	let exporting = false;

	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
	$: ({ names: templates, selected: template, loaded: templatesLoaded } = $reportTemplateStore);
	$: includeTestCases = $reportMetadata.custom_properties?.include_test_cases !== false;
	$: truncating = $reportMetadata.truncate_length > 0;

	onMount(() =>
		reportTemplateStore.reload().catch((error) => toastError(toastStore, "Failed to load report templates", error)),
	);

	// Runs one template change, toasting `done` or the failure.
	async function change(what, run, done, failed) {
		if (changing) return;
		changing = what;
		try {
			await run();
			toastStore.trigger({ message: done, background: "variant-filled-success" });
		} catch (error) {
			toastError(toastStore, failed, error);
		} finally {
			changing = "";
		}
	}

	// A template file from this machine, stored under its own name.
	function upload(file) {
		if (!file) return;
		change(
			"upload",
			async () => reportTemplateStore.upload(file.name, new Uint8Array(await file.arrayBuffer())),
			"Template uploaded",
			"Failed to upload the template",
		);
	}

	// The first click asks, the second deletes the picked template.
	function deleteTemplate() {
		if (!confirmDelete) return (confirmDelete = true);
		confirmDelete = false;
		const name = template;
		change("delete", () => reportTemplateStore.remove(name), "Template deleted", "Failed to delete the template");
	}

	// The first click asks, the second overwrites default_template.md.
	function restoreDefault() {
		if (!confirmRestore) return (confirmRestore = true);
		confirmRestore = false;
		change(
			"restore",
			() => reportTemplateStore.restore(),
			"Default template restored",
			"Failed to restore the default template",
		);
	}

	function setIncludeTestCases(on) {
		reportMetadata.update((m) => ({
			...m,
			custom_properties: { ...m.custom_properties, include_test_cases: on },
		}));
	}

	function setTruncating(on) {
		reportMetadata.update((m) => ({ ...m, truncate_length: on ? TRUNCATE_DEFAULT : 0 }));
	}

	async function exportReport() {
		if (exporting || !template) return;
		exporting = true;
		// ExportReport sends created_at in this machine's zone.
		const payload = {
			...$reportMetadata,
			custom_properties: { ...$reportMetadata.custom_properties, include_test_cases: includeTestCases },
			created_at: new Date().toISOString(),
		};
		try {
			if (await ExportReport(template, payload)) {
				toastStore.trigger({ message: "Report saved", background: "variant-filled-success" });
				modalStore.close();
			}
		} catch (error) {
			toastError(toastStore, "Failed to export the report", error);
		} finally {
			exporting = false;
		}
	}

	function openGap(gap) {
		modalStore.close();
		logbookStore.open(gap.kind, gap.record.ID, gap.key);
	}

	const label = "mb-1 block text-2xs font-semibold opacity-70";
	const input = "input h-8 py-1 text-xs";
</script>

{#if $modalStore[0]}
	<div
		class="logbook-export card flex h-[min(42.5rem,86vh)] w-[min(70rem,94vw)] flex-col overflow-hidden rounded-none text-xs shadow-xl bg-surface-50-800-token text-surface-900-50-token"
	>
		<header class="flex h-11 flex-none items-center gap-2 border-b border-surface-500/30 px-3">
			<FileText size={16} class="text-primary-500" />
			<h2 class="flex-1 text-base font-bold">Export report</h2>
			<button class="p-1 opacity-60 hover:opacity-100" title="Close (Esc)" aria-label="Close" on:click={modalStore.close}
				><X size={16} /></button
			>
		</header>
		<div class="flex min-h-0 flex-1">
			<div class="min-w-0 flex-1 space-y-4 overflow-auto px-5 py-4">
				<section>
					<span class={label}>Template</span>
					<div class="flex items-center gap-2">
						<select
							id="exportTemplate"
							class="select h-8 min-w-0 flex-1 py-0 text-xs"
							value={template}
							on:change={(e) => reportTemplateStore.select(e.currentTarget.value)}
							disabled={!templatesLoaded || !templates.length}
						>
							{#each templates as name}<option value={name}>{name}</option>{/each}
						</select>
						<label
							id="exportUploadTemplate"
							class="flex flex-none cursor-pointer items-center gap-1 text-2xs opacity-70 hover:opacity-100"
							title="Upload a template from this machine"
							><Upload size={12} />{changing === "upload" ? "Uploading…" : "Upload"}<input
								type="file"
								class="hidden"
								data-template-input
								disabled={Boolean(changing)}
								on:change={(e) => {
									upload(e.currentTarget.files?.[0]);
									e.currentTarget.value = "";
								}}
							/></label
						>
						<button
							id="exportDeleteTemplate"
							type="button"
							class="flex max-w-[16rem] flex-none items-center gap-1 text-2xs {confirmDelete
								? 'font-semibold text-error-700 dark:text-error-400'
								: 'opacity-70 hover:opacity-100'}"
							disabled={Boolean(changing) || !template}
							on:click={deleteTemplate}
							on:blur={() => (confirmDelete = false)}
							><Trash2 size={12} class="flex-none" /><span class="truncate"
								>{changing === "delete" ? "Deleting…" : confirmDelete ? `Delete ${template}?` : "Delete"}</span
							></button
						>
						<button
							id="exportRestoreDefault"
							type="button"
							class="flex flex-none items-center gap-1 text-2xs {confirmRestore
								? 'font-semibold text-warning-800 dark:text-warning-500'
								: 'opacity-70 hover:opacity-100'}"
							disabled={Boolean(changing)}
							on:click={restoreDefault}
							on:blur={() => (confirmRestore = false)}
							><RotateCcw size={12} />{changing === "restore"
								? "Restoring…"
								: confirmRestore
									? "Overwrite default_template.md?"
									: "Restore default"}</button
						>
					</div>
				</section>
				<section>
					<h3 class="mb-2 text-sm font-bold">Report details</h3>
					<div class="grid grid-cols-6 gap-x-3 gap-y-2.5">
						<label class="col-span-4"
							><span class={label}>Title</span><input class={input} bind:value={$reportMetadata.title} /></label
						>
						<label class="col-span-2"
							><span class={label}>Assessor</span><input class={input} bind:value={$reportMetadata.assessor} /></label
						>
						<label class="col-span-3"
							><span class={label}>Client</span><input class={input} bind:value={$reportMetadata.client} /></label
						>
						<label class="col-span-3"
							><span class={label}>Assessment type</span><input class={input} bind:value={$reportMetadata.type} /></label
						>
						<label class="col-span-4"
							><span class={label}>Scope</span><input class={input} bind:value={$reportMetadata.scope} /></label
						>
						<div class="col-span-2 grid grid-cols-2 gap-2">
							<label
								><span class={label}>Start</span><input
									type="date"
									class="{input} px-2"
									bind:value={$reportMetadata.start}
								/></label
							>
							<label
								><span class={label}>End</span><input type="date" class="{input} px-2" bind:value={$reportMetadata.end} /></label
							>
						</div>
					</div>
				</section>
				<section>
					<h3 class="mb-2 text-sm font-bold">Options</h3>
					<div class="divide-y divide-surface-500/20 ring-1 ring-surface-500/30">
						<div class="flex h-10 items-center gap-3 px-3">
							<div class="min-w-0 flex-1 font-semibold">Include test cases</div>
							<SlideToggle
								name="exportIncludeTestCases"
								size="sm"
								active="bg-primary-500"
								label="Include test cases"
								checked={includeTestCases}
								on:change={(e) => setIncludeTestCases(e.currentTarget.checked)}
							/>
						</div>
						<div class="flex h-10 items-center gap-3 px-3">
							<div class="min-w-0 flex-1 font-semibold">Mark as draft</div>
							<SlideToggle
								name="exportDraft"
								size="sm"
								active="bg-primary-500"
								label="Mark as draft"
								bind:checked={$reportMetadata.is_draft}
							/>
						</div>
						<div class="flex h-10 items-center gap-3 px-3">
							<div class="flex min-w-0 flex-1 items-center gap-1.5">
								<span class="font-semibold">Truncate bodies</span>
								{#if truncating}
									<input
										id="exportTruncateLength"
										type="number"
										min="100"
										step="100"
										class="input ml-2 h-6 w-20 px-1.5 py-0 text-2xs"
										aria-label="Truncate length in bytes"
										bind:value={$reportMetadata.truncate_length}
									/><span class="text-2xs opacity-70">bytes</span>
								{/if}
							</div>
							<SlideToggle
								name="exportTruncate"
								size="sm"
								active="bg-primary-500"
								label="Truncate bodies"
								checked={truncating}
								on:change={(e) => setTruncating(e.currentTarget.checked)}
							/>
						</div>
					</div>
				</section>
			</div>
			<div
				class="w-[25rem] flex-none overflow-auto border-l border-surface-500/30 bg-surface-100/60 px-5 py-4 dark:bg-surface-900/40"
			>
				<ReportReview store={logbookStore} {includeTestCases} onGap={openGap} />
			</div>
		</div>
		<footer class="flex flex-none justify-end gap-2 border-t border-surface-500/30 px-3 py-2">
			<button type="button" class="btn btn-sm {neutral}" on:click={modalStore.close}>Cancel</button>
			<button
				id="exportReport"
				type="button"
				class="btn btn-sm {primary}"
				disabled={exporting || !template}
				on:click={exportReport}
				><SquareArrowRight size={13} class="mr-1" />{exporting ? "Exporting…" : "Export report"}</button
			>
		</footer>
	</div>
{/if}
