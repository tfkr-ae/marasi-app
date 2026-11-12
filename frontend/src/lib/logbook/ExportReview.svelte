<script>
	// The export modal. On the left, the template (Restore default asks once
	// inline), the report details and the options as switch rows; on the
	// right, the review of what the report holds. Export renders the report
	// on the service with reportMetadata (custom_properties.include_test_cases
	// decides whether test cases are listed) and saves it through the native
	// Save dialog. Clicking a gap closes the modal and opens that record at
	// the missing item.
	import PaneTabs from "../components/PaneTabs.svelte";
	import { getModalStore, getToastStore, modeCurrent, SlideToggle } from "@skeletonlabs/skeleton";
	import { onMount } from "svelte";
	import { FileText, RotateCcw, SquareArrowRight, X } from "lucide-svelte";
	import { neutralVariant, primaryVariant } from "../launchpad/format.js";
	import { toastError } from "../toasts.js";
	import { reportMetadata } from "../../stores";
	import { logbookStore } from "../../stores/logbookStore";
	import { keptTemplate, reportTemplateEvents } from "../../stores/logbookEvents.js";
	import { service } from "../service/index.js";
	import ReportReview from "./ReportReview.svelte";

	export let parent = undefined;

	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const TRUNCATE_DEFAULT = 1000;

	let templates = [];
	let template;
	let loadingTemplates = true;
	let confirmRestore = false;
	let restoring = false;
	let exporting = false;

	$: primary = primaryVariant($modeCurrent);
	$: neutral = neutralVariant($modeCurrent);
	$: includeTestCases = $reportMetadata.custom_properties?.include_test_cases !== false;
	$: truncating = $reportMetadata.truncate_length > 0;

	// Templates added, removed or restored anywhere (the CLI, another app)
	// show while the review is open.
	onMount(() => {
		const stops = Object.entries(
			reportTemplateEvents((names) => {
				templates = names;
				template = keptTemplate(names, template);
			}),
		).map(([name, handler]) => service.on(name, handler));
		return () => stops.forEach((stop) => stop());
	});

	onMount(async () => {
		try {
			templates = (await logbookStore.listTemplates()) ?? [];
			template = templates[0];
		} catch (error) {
			toastError(toastStore, "Failed to load report templates", error);
		} finally {
			loadingTemplates = false;
		}
	});

	// The first click asks, the second overwrites default_template.md.
	async function restoreDefault() {
		if (restoring) return;
		if (!confirmRestore) return (confirmRestore = true);
		confirmRestore = false;
		restoring = true;
		try {
			await logbookStore.restoreDefaultTemplate();
			toastStore.trigger({ message: "Default template restored", background: "variant-filled-success" });
		} catch (error) {
			toastError(toastStore, "Failed to restore the default template", error);
		} finally {
			restoring = false;
		}
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
		const metadata = {
			...$reportMetadata,
			custom_properties: { ...$reportMetadata.custom_properties, include_test_cases: includeTestCases },
			created_at: new Date().toISOString(),
		};
		try {
			if (await logbookStore.exportReport(template, metadata)) {
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
	// Narrow iOS screens show the details or the report's preview, as tabs.
	let narrowPane = "details";
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
		<PaneTabs
			tabs={[
				{ id: "details", label: "Details" },
				{ id: "preview", label: "Preview" },
			]}
			bind:active={narrowPane}
		/>
		<div class="flex min-h-0 flex-1">
			<div class="min-w-0 flex-1 space-y-4 overflow-auto px-5 py-4" class:pane-off={narrowPane !== "details"}>
				<section>
					<span class={label}>Template</span>
					<div class="flex items-center gap-2">
						<select
							id="exportTemplate"
							class="select h-8 min-w-0 flex-1 py-0 text-xs"
							bind:value={template}
							disabled={loadingTemplates || !templates.length}
						>
							{#each templates as name}<option value={name}>{name}</option>{/each}
						</select>
						<button
							id="exportRestoreDefault"
							type="button"
							class="flex flex-none items-center gap-1 text-2xs {confirmRestore
								? 'font-semibold text-warning-800 dark:text-warning-500'
								: 'opacity-70 hover:opacity-100'}"
							disabled={restoring}
							on:click={restoreDefault}
							on:blur={() => (confirmRestore = false)}
							><RotateCcw size={12} />{restoring
								? "Restoring…"
								: confirmRestore
									? "Overwrite default_template.md?"
									: "Restore default"}</button
						>
					</div>
				</section>
				<section>
					<h3 class="mb-2 text-sm font-bold">Report details</h3>
					<div class="export-details grid grid-cols-6 gap-x-3 gap-y-2.5">
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
						<div class="export-option flex h-10 items-center gap-3 px-3">
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
						<div class="export-option flex h-10 items-center gap-3 px-3">
							<div class="min-w-0 flex-1 font-semibold">Mark as draft</div>
							<SlideToggle
								name="exportDraft"
								size="sm"
								active="bg-primary-500"
								label="Mark as draft"
								bind:checked={$reportMetadata.is_draft}
							/>
						</div>
						<div class="export-option flex h-10 items-center gap-3 px-3">
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
				class:pane-off={narrowPane !== "preview"}
				class="export-preview w-[25rem] flex-none overflow-auto border-l border-surface-500/30 bg-surface-100/60 px-5 py-4 dark:bg-surface-900/40"
			>
				<ReportReview store={logbookStore} {includeTestCases} onGap={openGap} />
			</div>
		</div>
		<footer class="export-foot flex flex-none justify-end gap-2 border-t border-surface-500/30 px-3 py-2">
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

<style>
	/* The mobile layout (html.mobile, lib/platform.js). The selectors are
	   global, as app.css's shared mobile rules are, so they weigh the same
	   against Skeleton's and Tailwind's classes. */
	/* Export review, narrow mobile: Details | Preview tabs (ExportReview.svelte),
	   the details one field to a row, options that wrap, and Cancel and
	   Export sharing the foot. */
	@media (max-width: 40rem) {
		:global(html.mobile .export-preview) {
			flex: 1 1 0;
			width: auto;
			border-left-width: 0;
		}
		:global(html.mobile .export-details) {
			grid-template-columns: minmax(0, 1fr);
		}
		:global(html.mobile .export-details > *) {
			grid-column: 1 / -1;
		}
		:global(html.mobile .export-option) {
			height: auto;
			min-height: 2.75rem;
			flex-wrap: wrap;
			padding-top: 0.375rem;
			padding-bottom: 0.375rem;
		}
		:global(html.mobile .export-foot > .btn) {
			flex: 1 1 0;
		}
	}
</style>
