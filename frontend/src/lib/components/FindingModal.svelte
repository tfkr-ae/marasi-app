<script>
	import {
		Accordion,
		AccordionItem,
		Autocomplete,
		FileDropzone,
		getModalStore,
		getToastStore,
	} from "@skeletonlabs/skeleton";
	import {
		Download,
		FileIcon,
		ImageIcon,
		ShieldAlert,
		Video,
		X,
	} from "lucide-svelte";
	import { testCaseStore } from "../../stores/testCaseStore";
	import { findingStore } from "../../stores/findingStore";
	import RequestResponseView from "./RequestResponseView.svelte";
	import { createRequestPicker } from "../requestPicker.js";
	import { ledgerStore } from "../../stores/ledgerStore";
	import CVSSCalculator from "./CVSSCalculator.svelte";
	import { severityFromScore } from "../cvss.js";
	import { GetArtifact, DownloadArtifact } from "../wailsjs/go/main/App";
	import { onDestroy } from "svelte";
	import ProgressRadial from "../extensions/components/ProgressRadial.svelte";
	export let parent;
	const modalStore = getModalStore();
	const toastStore = getToastStore();
	const MAX_FILE_SIZE = 20 * 1024 * 1024;
	let finding = structuredClone($modalStore[0]?.meta?.finding || {});
	let originalRequestCount = finding?.Requests?.length || 0;
	let isNew = $modalStore[0]?.meta?.isNew || false;
	let testCaseInput = "";
	let requestInput = "";
	let imageUrls = {};
	let showTestCaseSearch = false;
	// Seeded with the saved score so opening a finding keeps a manually set severity.
	let lastSeenScore = finding.CVSSScore;
	// The metrics start folded once a finding is scored.
	let cvssOpen = !finding.CVSSVector;

	$: autocompleteTestCases = [...$testCaseStore]
		.reverse()
		.map((tc, i) => ({
			label: `${i + 1} - ${tc.Title}`,
			value: tc.ID,
			...tc,
		}));

	$: artifacts =
		$findingStore.find((fnd) => fnd.ID === finding.ID)?.Artifacts ||
		[];
	$: requests =
		$findingStore.find((fnd) => fnd.ID === finding.ID)?.Requests ||
		[];
	// The picker searches the project's traffic as the researcher types,
	// newest first, rather than holding every pair.
	const requestPicker = createRequestPicker(ledgerStore.searchRequests);
	$: requestPicker.search(requestInput);
	$: displayedRequests = $requestPicker;
	onDestroy(requestPicker.cancel);
	const passThroughFilter = () => displayedRequests;

	$: {
		if (finding.CVSSScore !== lastSeenScore) {
			lastSeenScore = finding.CVSSScore;

			const severity = finding.CVSSVector ? severityFromScore(finding.CVSSScore) : null;
			if (severity) finding.Severity = severity;
		}
	}
	function handleAccordionScroll(e) {
		const target = e.currentTarget;
		setTimeout(() => {
			if (target) {
				target.scrollIntoView({
					behavior: "smooth",
					block: "start",
				});
			}
		}, 250);
	}

	const testCaseFilter = () => {
		const inputFormatted = testCaseInput.toLowerCase().trim();
		if (!inputFormatted) return autocompleteTestCases;
		return autocompleteTestCases.filter((opt) =>
			opt.label.toLowerCase().includes(inputFormatted),
		);
	};

	async function handleAccordionOpen(art) {
		const isSupported =
			art.MimeType?.startsWith("image/") ||
			art.MimeType?.startsWith("video/");
		if (!isSupported || imageUrls[art.ID]) return;

		try {
			const fullArtifact = await GetArtifact(art.ID);

			if (fullArtifact && fullArtifact.Data) {
				const binaryString = atob(fullArtifact.Data);

				const len = binaryString.length;
				const bytes = new Uint8Array(len);
				for (let i = 0; i < len; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}

				const blob = new Blob([bytes], {
					type: fullArtifact.MimeType,
				});
				const url = URL.createObjectURL(blob);

				imageUrls = { ...imageUrls, [art.ID]: url };
			}
		} catch (err) {
			console.error("Failed to load artifact data:", err);
			toastStore.trigger({
				message: "Error loading artifact",
				background: "variant-filled-error",
			});
		}
	}

	async function downloadArtifact(artifactID) {
		try {
			const wasSaved = await DownloadArtifact(artifactID);

			if (wasSaved) {
				toastStore.trigger({
					message: "File saved successfully",
					background: "variant-filled-success",
				});
			}
		} catch (err) {
			console.error("Download error:", err);
			toastStore.trigger({
				message: "Error saving file: " + err,
				background: "variant-filled-error",
			});
		}
	}
	onDestroy(() => {
		Object.values(imageUrls).forEach((url) => {
			URL.revokeObjectURL(url);
		});
		imageUrls = {};

		const liveFinding = $findingStore.find(
			(f) => f.ID === finding.ID,
		);

		if (isNew) {
			const isDraft =
				finding.Title.trim() === "Draft Finding" &&
				finding.Severity.trim() === "High" &&
				finding.CVSSVector.trim() === "" &&
				(parseFloat(finding.CVSSScore) || 0) === 0 &&
				finding.WriteUp.trim() === "Writeup" &&
				finding.TreatmentPlan.trim() === "";

			const hasDataChanges =
				liveFinding?.Artifacts?.length > 0 ||
				liveFinding?.Requests?.length !==
					originalRequestCount;

			if (isDraft && !hasDataChanges) {
				findingStore
					.delete(finding.ID)
					.catch(console.error);
			} else {
				finding.Requests = liveFinding?.Requests || [];
				finding.Artifacts =
					liveFinding?.Artifacts || [];
				findingStore
					.save(finding)
					.then(() => {
						toastStore.trigger({
							message: "Saved finding",
							background: "variant-filled-success",
						});
					})
					.catch((err) => {
						toastStore.trigger({
							message:
								"Failed to save: " +
								err,
							background: "variant-filled-error",
						});
					});
			}
		} else {
			finding.Requests = liveFinding?.Requests || [];
			finding.Artifacts = liveFinding?.Artifacts || [];
			findingStore
				.save(finding)
				.then(() => {
					toastStore.trigger({
						message: "Saved finding",
						background: "variant-filled-success",
					});
				})
				.catch((err) => {
					toastStore.trigger({
						message:
							"Failed to save: " +
							err,
						background: "variant-filled-error",
					});
				});
		}
	});
</script>

{#if $modalStore[0]}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="card p-4 text-sm w-[75%] max-w-[95vw] shadow-xl rounded-none flex flex-col max-h-[95vh] border-t-4 border-primary-500 bg-surface-50-800-token text-surface-900-50-token"
		on:keydown={(event) => {
			if (event.key === "Escape") {
				event.stopImmediatePropagation();
				modalStore.close();
			}
		}}
	>
		<header class="flex justify-between items-center p-2">
			<div class="flex items-center gap-2">
				<ShieldAlert
					size={18}
					class="text-primary-500"
				/>
				<h2 class="text-base font-bold">New Finding</h2>
			</div>

			<button
				class="text-base leading-none"
				aria-label="Close"
				on:click={modalStore.close}
			>
				<X size={18} />
			</button>
		</header>
		<form
			class="overflow-y-auto grid grid-cols-4 gap-3 custom-scrollbar"
		>
			<label class="label col-span-3">
				<span>Title</span>
				<input
					class="input h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					type="text"
					bind:value={finding.Title}
				/>
			</label>
			<label class="label col-span-1">
				<span>Severity</span>
				<select
					class="select h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					bind:value={finding.Severity}
				>
					<option value="Critical"
						>Critical</option
					>
					<option value="High">High</option>
					<option value="Medium">Medium</option>
					<option value="Low">Low</option>
					<option value="Informational"
						>Informational</option
					>
				</select>
			</label>

			<div class="label col-span-4">
				<span>CVSS Score</span>
				<CVSSCalculator
					bind:vector={finding.CVSSVector}
					bind:score={finding.CVSSScore}
					bind:open={cvssOpen}
				/>
			</div>
			<label class="label col-span-4" for="Test Case">
				{#if showTestCaseSearch || finding.TestCaseID}
					<span class="mb-1"
						>Linked Test Case</span
					>
				{/if}

				{#if finding.TestCaseID}
					<div
						class="flex items-center justify-between px-2 variant-soft-primary rounded-token border border-primary-500/30 h-8"
					>
						<span
							class="text-sm font-semibold truncate"
						>
							{$testCaseStore.find(
								(tc) =>
									tc.ID ===
									finding.TestCaseID,
							)?.Title ||
								"Linked Test Case"}
						</span>
						<button
							type="button"
							class="btn-icon btn-icon-sm variant-filled-error shrink-0 ml-2"
							on:click={() => {
								finding.TestCaseID =
									null;
								showTestCaseSearch = false;
							}}
							title="Remove linked test case"
						>
							<X size={14} />
						</button>
					</div>
				{:else if showTestCaseSearch}
					<div
						class="flex items-center gap-2 h-8"
					>
						<input
							class="input h-full py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
							type="search"
							bind:value={
								testCaseInput
							}
							placeholder="Search Test Cases..."
							autocomplete="off"
						/>
						<button
							type="button"
							class="btn-icon btn-icon-sm variant-soft-error shrink-0"
							on:click={() => {
								showTestCaseSearch = false;
								testCaseInput =
									"";
							}}
						>
							<X size={14} />
						</button>
					</div>

					{#if testCaseInput.length > 0}
						<div
							class="card p-2 w-full max-h-[200px] overflow-y-auto mt-1 shadow-xl border border-surface-500 z-10 bg-white dark:bg-surface-700"
						>
							<Autocomplete
								bind:input={
									testCaseInput
								}
								options={autocompleteTestCases}
								filter={testCaseFilter}
								regionButton="w-full justify-start text-left truncate"
								on:selection={async (
									e,
								) => {
									finding.TestCaseID =
										e.detail.ID;
									testCaseInput =
										"";
									showTestCaseSearch = false;
								}}
							/>
						</div>
					{/if}
				{:else}
					<button
						type="button"
						class="btn btn-sm variant-soft-surface w-full border border-dashed border-surface-500/50 hover:variant-soft-primary transition-colors h-8"
						on:click={() =>
							(showTestCaseSearch = true)}
					>
						+ Link a Test Case
					</button>
				{/if}
			</label>
			<label class="label col-span-4" for="Requests">
				<span>Linked Requests</span>

				<input
					class="input h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					type="search"
					name="requestSearch"
					bind:value={requestInput}
					placeholder="Search to link a request..."
					autocomplete="off"
				/>

				{#if requestInput.length > 0}
					<div
						class="card p-2 w-full max-h-[200px] overflow-y-auto mt-2 shadow-sm border border-surface-500/30 bg-white dark:bg-surface-700"
					>
						<Autocomplete
							bind:input={
								requestInput
							}
							options={displayedRequests}
							filter={passThroughFilter}
							regionButton="w-full justify-start text-left truncate"
							on:selection={async (
								e,
							) => {
								const selectedID =
									e.detail
										.ID;
								requestInput =
									"";

								if (
									requests.includes(
										selectedID,
									)
								) {
									toastStore.trigger(
										{
											message: "Request already linked",
											background: "variant-filled-error",
										},
									);
									return;
								}

								try {
									await findingStore.linkRequest(
										finding.ID,
										selectedID,
									);
									toastStore.trigger(
										{
											message: "Request linked",
											background: "variant-filled-success",
										},
									);
								} catch (err) {
									toastStore.trigger(
										{
											message: "Failed to link request",
											background: "variant-filled-error",
										},
									);
								}
							}}
						/>
					</div>
				{/if}

				{#if requests && requests.length > 0}
					<Accordion>
						{#each requests as request, i}
							<AccordionItem
								on:click={(
									e,
								) => {
									handleAccordionScroll(
										e,
									);
								}}
							>
								<svelte:fragment
									slot="summary"
								>
									<div
										class="flex justify-between items-center w-full"
									>
										<span
											>Request
											{i +
												1}</span
										>
										<button
											type="button"
											class="btn-icon btn-icon-sm variant-soft-error shrink-0"
											on:click|stopPropagation={async () => {
												try {
													await findingStore.unlinkRequest(
														finding.ID,
														request,
													);

													toastStore.trigger(
														{
															message: "Request unlinked",
															background: "variant-filled-success",
														},
													);
												} catch (err) {
													toastStore.trigger(
														{
															message: "Failed to unlink request",
															background: "variant-filled-error",
														},
													);
												}
											}}
											title="Unlink Request"
										>
											<X
												size={14}
											/>
										</button>
									</div>
								</svelte:fragment>

								<svelte:fragment
									slot="content"
								>
									<RequestResponseView
										request_id={request}
										showTitleBar={false}
									/>
								</svelte:fragment>
							</AccordionItem>
						{/each}
					</Accordion>
				{:else}
					<div
						class="mt-3 p-3 variant-soft rounded-token text-xs opacity-70 text-center"
					>
						No requests linked. Search above
						to add one.
					</div>
				{/if}
			</label>
			<label class="label col-span-4 md:col-span-2">
				<span>Writeup</span>
				<textarea
					class="textarea text-sm rounded-none bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					rows="10"
					bind:value={finding.WriteUp}
					placeholder="Finding Writeup"
				/>
			</label>
			<label class="label col-span-4 md:col-span-2">
				<span>Treatment Plan</span>
				<textarea
					class="textarea text-sm rounded-none bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
					rows="10"
					bind:value={finding.TreatmentPlan}
					placeholder="Treatment Plan"
				/>
			</label>
			<label class="label col-span-4" for="Artifacts">
				<span>Artifacts</span>

				<FileDropzone
					name="files"
					multiple
					class="bg-white dark:bg-surface-700"
					on:change={async (e) => {
						const fileList = e.target.files;
						if (!fileList.length) return;

						const newFiles =
							Array.from(fileList);
						const validFiles =
							newFiles.filter(
								(file) => {
									if (
										file.size >
										MAX_FILE_SIZE
									) {
										toastStore.trigger(
											{
												message: `File too large: ${file.name} (Max 20MB)`,
												background: "variant-filled-error",
											},
										);
										return false;
									}
									return true;
								},
							);

						for (const file of validFiles) {
							findingStore
								.uploadArtifact(
									finding.ID,
									file,
								)
								.then(() => {
									toastStore.trigger(
										{
											message: `Artifact uploaded: ${file.name}`,
											background: "variant-filled-success",
										},
									);
								})
								.catch(
									(
										err,
									) => {
										console.error(
											`Failed to upload ${file.name}:`,
											err,
										);
										toastStore.trigger(
											{
												message: `Error uploading ${file.name}: ${err}`,
												background: "variant-filled-error",
											},
										);
									},
								);
						}
					}}
				/>

				{#if artifacts && artifacts.length > 0}
					<Accordion>
						{#each artifacts as art, i (art.ID)}
							{#if art?.MimeType?.startsWith("image/")}
								<AccordionItem
									regionCaret="hidden"
									disabled={art.Status ===
										"uploading"}
									on:click={(
										e,
									) => {
										handleAccordionOpen(
											art,
										);
										handleAccordionScroll(
											e,
										);
									}}
								>
									<svelte:fragment
										slot="summary"
									>
										<div
											class="flex justify-between items-center w-full"
										>
											<div
												class="flex items-center gap-2"
											>
												{#if art.Status === "uploading"}
													<ProgressRadial
														width="w-4"
														stroke={100}
													/>
												{:else}
													<ImageIcon
														size={16}
														class="text-primary-500"
													/>
												{/if}
												<span
													class={art.Status ===
													"uploading"
														? "opacity-50"
														: ""}
												>
													{art.Filename}
												</span>
											</div>
											<div
												class="flex gap-2"
											>
												<button
													type="button"
													class="btn-icon btn-icon-sm variant-soft-primary"
													disabled={art.Status ===
														"uploading"}
													on:click|stopPropagation={() =>
														downloadArtifact(
															art.ID,
														)}
												>
													<Download
														size={14}
													/>
												</button>
												<button
													type="button"
													class="btn-icon btn-icon-sm variant-soft-error shrink-0"
													disabled={art.Status ===
														"uploading"}
													on:click|stopPropagation={() => {
														if (
															art.Status !==
															"uploading"
														) {
															findingStore
																.deleteArtifact(
																	finding.ID,
																	art.ID,
																)
																.then(
																	() => {
																		toastStore.trigger(
																			{
																				message: "Artifact deleted",
																				background: "variant-filled-success",
																			},
																		);

																		if (
																			imageUrls[
																				art
																					.ID
																			]
																		) {
																			URL.revokeObjectURL(
																				imageUrls[
																					art
																						.ID
																				],
																			);
																			delete imageUrls[
																				art
																					.ID
																			];
																		}
																	},
																)
																.catch(
																	(
																		err,
																	) => {
																		console.error(
																			"Delete failed:",
																			err,
																		);
																		toastStore.trigger(
																			{
																				message: "Failed to delete artifact",
																				background: "variant-filled-error",
																			},
																		);
																	},
																);
														}
													}}
												>
													<X
														size={14}
													/>
												</button>
											</div>
										</div>
									</svelte:fragment>

									<svelte:fragment
										slot="content"
									>
										<div
											class="flex justify-center p-2 bg-surface-50 dark:bg-surface-900/50 rounded min-h-[100px] items-center border-t border-surface-500/20"
										>
											{#if imageUrls[art.ID]}
												<img
													src={imageUrls[
														art
															.ID
													]}
													alt={art.Filename}
													class="max-h-[400px] w-auto rounded shadow-xl border border-white/10"
												/>
											{:else}
												<div
													class="flex flex-col items-center gap-2"
												>
													<ProgressRadial
														width="w-8"
														stroke={100}
													/>
													<span
														class="text-xs opacity-50 italic text-center"
													>
														{art.Status ===
														"uploading"
															? "Uploading..."
															: "Fetching data..."}
													</span>
												</div>
											{/if}
										</div>
									</svelte:fragment>
								</AccordionItem>
							{:else if art.MimeType?.startsWith("video/")}
								<AccordionItem
									regionCaret="hidden"
									disabled={art.Status ===
										"uploading"}
									on:click={(
										e,
									) => {
										handleAccordionOpen(
											art,
										);
										handleAccordionScroll(
											e,
										);
									}}
								>
									<svelte:fragment
										slot="summary"
									>
										<div
											class="flex justify-between items-center w-full"
										>
											<div
												class="flex items-center gap-2"
											>
												{#if art.Status === "uploading"}
													<ProgressRadial
														width="w-4"
														stroke={100}
													/>
												{:else}
													<Video
														size={16}
														class="text-primary-500"
													/>
												{/if}
												<span
													class={art.Status ===
													"uploading"
														? "opacity-50"
														: ""}
												>
													{art.Filename}
												</span>
											</div>
											<div
												class="flex gap-2"
											>
												<button
													type="button"
													class="btn-icon btn-icon-sm variant-soft-primary"
													disabled={art.Status ===
														"uploading"}
													on:click|stopPropagation={() =>
														downloadArtifact(
															art.ID,
														)}
												>
													<Download
														size={14}
													/>
												</button>
												<button
													type="button"
													class="btn-icon btn-icon-sm variant-soft-error"
													disabled={art.Status ===
														"uploading"}
													on:click|stopPropagation={() => {
														if (
															art.Status !==
															"uploading"
														) {
															findingStore
																.deleteArtifact(
																	finding.ID,
																	art.ID,
																)
																.then(
																	() => {
																		toastStore.trigger(
																			{
																				message: "Artifact deleted",
																				background: "variant-filled-success",
																			},
																		);
																		if (
																			imageUrls[
																				art
																					.ID
																			]
																		) {
																			URL.revokeObjectURL(
																				imageUrls[
																					art
																						.ID
																				],
																			);
																			delete imageUrls[
																				art
																					.ID
																			];
																		}
																	},
																)
																.catch(
																	(
																		err,
																	) => {
																		console.error(
																			"Delete failed:",
																			err,
																		);
																		toastStore.trigger(
																			{
																				message: "Failed to delete artifact",
																				background: "variant-filled-error",
																			},
																		);
																	},
																);
														}
													}}
												>
													<X
														size={14}
													/>
												</button>
											</div>
										</div>
									</svelte:fragment>

									<svelte:fragment
										slot="content"
									>
										<div
											class="flex justify-center p-2 bg-surface-50 dark:bg-surface-900/50 rounded min-h-[100px] items-center border-t border-surface-500/20"
										>
											{#if imageUrls[art.ID]}
												<video
													controls
													src={imageUrls[
														art
															.ID
													]}
													class="max-h-[400px] w-auto rounded shadow-xl border border-white/10"
												>
													<track
														kind="captions"
													/>
												</video>
											{:else}
												<div
													class="flex flex-col items-center gap-2"
												>
													<ProgressRadial
														width="w-8"
														stroke={100}
													/>
													<span
														class="text-xs opacity-50 italic"
														>Loading
														video...</span
													>
												</div>
											{/if}
										</div>
									</svelte:fragment>
								</AccordionItem>
							{:else}
								<div
									class="flex justify-between items-center px-3 py-2 variant-soft rounded-token border-b border-surface-500/10"
								>
									<div
										class="flex items-center gap-2 {art.Status ===
										'uploading'
											? 'opacity-50'
											: 'opacity-70'}"
									>
										{#if art.Status === "uploading"}
											<ProgressRadial
												width="w-4"
												stroke={100}
											/>
										{:else}
											<FileIcon
												size={16}
											/>
										{/if}
										<span
											>{art.Filename}</span
										>
									</div>
									<div
										class="flex gap-2"
									>
										<button
											type="button"
											class="btn-icon btn-icon-sm variant-soft-primary"
											disabled={art.Status ===
												"uploading"}
											on:click|stopPropagation={() =>
												downloadArtifact(
													art.ID,
												)}
										>
											<Download
												size={14}
											/>
										</button>
										<button
											type="button"
											class="btn-icon btn-icon-sm variant-soft-error shrink-0"
											disabled={art.Status ===
												"uploading"}
											on:click|stopPropagation={() => {
												if (
													art.Status !==
													"uploading"
												) {
													findingStore
														.deleteArtifact(
															finding.ID,
															art.ID,
														)
														.then(
															() => {
																toastStore.trigger(
																	{
																		message: "Artifact deleted",
																		background: "variant-filled-success",
																	},
																);

																if (
																	imageUrls[
																		art
																			.ID
																	]
																) {
																	URL.revokeObjectURL(
																		imageUrls[
																			art
																				.ID
																		],
																	);
																	delete imageUrls[
																		art
																			.ID
																	];
																}
															},
														)
														.catch(
															(
																err,
															) => {
																console.error(
																	"Delete failed:",
																	err,
																);
																toastStore.trigger(
																	{
																		message: "Failed to delete artifact",
																		background: "variant-filled-error",
																	},
																);
															},
														);
												}
											}}
										>
											<X
												size={14}
											/>
										</button>
									</div>
								</div>
							{/if}
						{/each}
					</Accordion>
				{:else}
					<div
						class="mt-3 p-3 variant-soft rounded-token text-xs opacity-70 text-center"
					>
						No artifacts uploaded. Drop
						files above to attach them.
					</div>
				{/if}
			</label>
		</form>
	</div>
{/if}
