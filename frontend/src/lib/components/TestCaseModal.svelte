<script>
    import {
        Accordion,
        AccordionItem,
        Autocomplete,
        FileDropzone,
        getModalStore,
        getToastStore,
        InputChip,
    } from "@skeletonlabs/skeleton";
    import { onDestroy, onMount } from "svelte";
    import { ProgressRadial } from "@skeletonlabs/skeleton";
    import { GetArtifact, DownloadArtifact } from "../wailsjs/go/main/App";
    import {
        BookCheck,
        Download,
        FileIcon,
        ImageIcon,
        Video,
        X,
    } from "lucide-svelte";
    import { marasiConfig, proxyItems } from "../../stores";
    import RequestResponseView from "./RequestResponseView.svelte";
    import { testCaseStore } from "../../stores/testCaseStore";
    export let parent;
    const modalStore = getModalStore();
    const toastStore = getToastStore();
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    let testCase = structuredClone($modalStore[0]?.meta?.testCase || {});
    let originalRequestCount = testCase?.Requests?.length || 0;
    let isNew = $modalStore[0]?.meta?.isNew || false;
    let requestInput = "";
    let templateSearchInput = "";
    let showTemplateSearch = isNew;
    let imageUrls = {};
    let displayedRequests = [];
    let requestSearchTimeout;

    if (!testCase.Tags || testCase.Tags.length === 0) {
        testCase.Tags = ["example_tag"];
    }
    $: artifacts =
        $testCaseStore.find((tc) => tc.ID === testCase.ID)?.Artifacts || [];
    $: requests =
        $testCaseStore.find((tc) => tc.ID === testCase.ID)?.Requests || [];
    $: allRequests = $proxyItems.map((item, i) => {
        const label = `${i + 1} - ${item.Scheme}://${item.Host}${item.Path}`;
        return {
            label,
            searchLabel: label.toLowerCase(),
            value: item.ID,
            ...item,
        };
    });
    $: {
        clearTimeout(requestSearchTimeout);

        requestSearchTimeout = setTimeout(() => {
            const inputFormatted = requestInput.toLowerCase().trim();

            if (!inputFormatted) {
                displayedRequests = allRequests.slice(0, 100);
            } else {
                const matches = [];
                for (let i = 0; i < allRequests.length; i++) {
                    if (allRequests[i].searchLabel.includes(inputFormatted)) {
                        matches.push(allRequests[i]);
                    }
                    if (matches.length === 100) break;
                }
                displayedRequests = matches;
            }
        }, 200);
    }
    const passThroughFilter = () => displayedRequests;

    $: if (testCase.Tags?.length > 1 && testCase.Tags.includes("example_tag")) {
        testCase.Tags = testCase.Tags.filter((tag) => tag !== "example_tag");
    }

    $: templateOptions = ($marasiConfig?.TestCaseProfile?.TestCases || []).map(
        (tc, i) => ({
            label: `[${tc.Category}] ${tc.Title}`,
            value: i,
            Title: tc.Title,
            Category: tc.Category,
            Description: tc.Description,
        }),
    );

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

                const blob = new Blob([bytes], { type: fullArtifact.MimeType });
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

    function handleAccordionScroll(e) {
        const target = e.currentTarget;
        setTimeout(() => {
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 250);
    }

    function templateFilter() {
        const inputFormatted = templateSearchInput.toLowerCase().trim();
        if (!inputFormatted) return templateOptions;

        return templateOptions.filter(
            (opt) =>
                opt.Title.toLowerCase().includes(inputFormatted) ||
                opt.Category.toLowerCase().includes(inputFormatted),
        );
    }
    onDestroy(() => {
        Object.values(imageUrls).forEach((url) => {
            URL.revokeObjectURL(url);
        });
        imageUrls = {};

        const liveTC = $testCaseStore.find((tc) => tc.ID === testCase.ID);

        if (isNew) {
            const isDraft =
                testCase.Title.trim() === "Draft Test Case" &&
                testCase.Description.trim() === "Test Case Description" &&
                testCase.Category.trim() === "XSS" &&
                testCase.Note.trim() === "Test Note";

            const hasDataChanges =
                liveTC?.Artifacts?.length > 0 ||
                liveTC?.Requests?.length !== originalRequestCount;

            if (isDraft && !hasDataChanges) {
                testCaseStore.delete(testCase.ID).catch(console.error);
            } else {
                testCase.Requests = liveTC?.Requests || [];
                testCase.Artifacts = liveTC?.Artifacts || [];
                testCase.Tags =
                    testCase.Tags?.filter((tag) => tag !== "example_tag") || [];

                testCaseStore
                    .save(testCase)
                    .then(() => {
                        toastStore.trigger({
                            message: "Saved test case",
                            background: "variant-filled-success",
                        });
                    })
                    .catch((err) => {
                        toastStore.trigger({
                            message: "Failed to save changes",
                            background: "variant-filled-error",
                        });
                    });
            }
        } else {
            testCase.Requests = liveTC?.Requests || [];
            testCase.Artifacts = liveTC?.Artifacts || [];
            testCase.Tags =
                testCase.Tags?.filter((tag) => tag !== "example_tag") || [];

            testCaseStore
                .save(testCase)
                .then(() => {
                    toastStore.trigger({
                        message: "Saved test case",
                        background: "variant-filled-success",
                    });
                })
                .catch((err) => {
                    console.error("Auto-save failed:", err);
                    toastStore.trigger({
                        message: "Failed to save changes",
                        background: "variant-filled-error",
                    });
                });
        }
    });

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
    onMount(() => {
        if (!showTemplateSearch) document.getElementById("titleInput").focus();
    });
</script>

{#if $modalStore[0]}
    <div
        class="card p-6 w-[75%] max-w-[95vw] shadow-xl rounded-none flex flex-col max-h-[95vh] border-t-4 border-tertiary-500"
    >
        <header class="flex justify-between items-center p-2">
            <div class="flex items-center gap-2">
                <BookCheck size={24} class="text-tertiary-500" />
                <h2 class="text-xl font-bold">New Test Case</h2>
            </div>

            <button
                class="text-2xl leading-none focus:outline-none"
                tabindex="-1"
                on:click={modalStore.close}
            >
                <X />
            </button>
        </header>
        <form class="overflow-y-auto grid grid-cols-4 gap-4 custom-scrollbar">
            {#if showTemplateSearch}
                <label class="label col-span-4" for="Template Search">
                    <span>Predefined Test Cases</span>

                    <div class="flex items-center gap-2 h-[42px]">
                        <input
                            id="templateSearch"
                            class="input"
                            type="search"
                            bind:value={templateSearchInput}
                            placeholder="Search predefined test cases"
                            autocomplete="off"
                        />
                        <button
                            type="button"
                            class="btn-icon btn-icon-sm variant-soft-tertiary shrink-0"
                            on:click={() => {
                                showTemplateSearch = false;
                                templateSearchInput = "";
                                setTimeout(
                                    () =>
                                        document
                                            .getElementById("titleInput")
                                            .focus(),
                                    50,
                                );
                            }}
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {#if templateSearchInput.length > 0}
                        <div
                            class="card p-2 w-full max-h-[200px] overflow-y-auto mt-2 shadow-sm border border-tertiary-500/30"
                        >
                            <Autocomplete
                                bind:input={templateSearchInput}
                                options={templateOptions}
                                filter={templateFilter}
                                on:selection={(e) => {
                                    testCase.Title = e.detail.Title || "";
                                    testCase.Category = e.detail.Category || "";
                                    testCase.Description =
                                        e.detail.Description || "";

                                    templateSearchInput = "";

                                    toastStore.trigger({
                                        message: "Populated from template",
                                        background: "variant-filled-tertiary",
                                    });
                                }}
                            />
                        </div>
                    {/if}
                </label>
            {:else}
                <label class="label col-span-4">
                    <button
                        type="button"
                        class="btn variant-soft-tertiary w-full border border-dashed border-surface-500/50 hover:variant-soft-tertiary transition-colors h-[42px]"
                        on:click={() => {
                            showTemplateSearch = true;
                            setTimeout(
                                () =>
                                    document
                                        .getElementById("templateSearch")
                                        .focus(),
                                50,
                            );
                        }}
                    >
                        {isNew ? "Use a Template" : "Overwrite from Template"}
                    </button>
                </label>
            {/if}

            <hr class="col-span-4 opacity-50" />
            <label class="label col-span-4 md:col-span-3">
                <span>Title</span>
                <input
                    id="titleInput"
                    class="input"
                    type="text"
                    bind:value={testCase.Title}
                />
            </label>
            <label class="label col-span-4 md:col-span-1">
                <span>Category</span>
                <input
                    class="input"
                    type="text"
                    bind:value={testCase.Category}
                />
            </label>
            <label class="label col-span-4">
                <span>Description</span>
                <input
                    class="input"
                    type="text"
                    bind:value={testCase.Description}
                />
            </label>
            <label class="label col-span-4" for="Test Case Tags">
                <span>Test Case Tags</span>
                <InputChip
                    bind:value={testCase.Tags}
                    name="chips"
                    placeholder="Tags"
                />
            </label>
            <label class="label col-span-4">
                <span>Note</span>
                <textarea
                    class="textarea rounded-none"
                    rows="10"
                    bind:value={testCase.Note}
                    placeholder="Request notes here"
                />
            </label>

            <label class="label col-span-4" for="Requests">
                <span>Linked Requests</span>

                <input
                    class="input"
                    type="search"
                    name="requestSearch"
                    bind:value={requestInput}
                    placeholder="Search to link a request..."
                    autocomplete="off"
                />

                {#if requestInput.length > 0}
                    <div
                        class="card p-2 w-full max-h-[200px] overflow-y-auto mt-2 shadow-sm border border-surface-500/30"
                    >
                        <Autocomplete
                            bind:input={requestInput}
                            options={displayedRequests}
                            filter={passThroughFilter}
                            on:selection={async (e) => {
                                const selectedID = e.detail.ID;
                                requestInput = "";

                                if (requests.includes(selectedID)) {
                                    toastStore.trigger({
                                        message: "Request already linked",
                                        background: "variant-filled-error",
                                    });
                                    return;
                                }

                                try {
                                    await testCaseStore.linkRequest(
                                        testCase.ID,
                                        selectedID,
                                    );
                                    toastStore.trigger({
                                        message: "Request linked",
                                        background: "variant-filled-success",
                                    });
                                } catch (err) {
                                    toastStore.trigger({
                                        message: "Failed to link request",
                                        background: "variant-filled-error",
                                    });
                                }
                            }}
                        />
                    </div>
                {/if}

                {#if requests && requests.length > 0}
                    <Accordion>
                        {#each requests as request, i}
                            <AccordionItem
                                on:click={(e) => handleAccordionScroll(e)}
                            >
                                <svelte:fragment slot="summary">
                                    <div
                                        class="flex justify-between items-center w-full"
                                    >
                                        <span>Request {i + 1}</span>
                                        <button
                                            type="button"
                                            class="btn-icon btn-icon-sm variant-soft-tertiary shrink-0"
                                            on:click|stopPropagation={async () => {
                                                try {
                                                    await testCaseStore.unlinkRequest(
                                                        testCase.ID,
                                                        request,
                                                    );
                                                    toastStore.trigger({
                                                        message:
                                                            "Request unlinked",
                                                        background:
                                                            "variant-filled-success",
                                                    });
                                                } catch (err) {
                                                    toastStore.trigger({
                                                        message:
                                                            "Failed to unlink request",
                                                        background:
                                                            "variant-filled-error",
                                                    });
                                                }
                                            }}
                                            title="Unlink Request"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </svelte:fragment>

                                <svelte:fragment slot="content">
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
                        class="mt-4 p-3 variant-soft rounded-token text-sm opacity-70 text-center"
                    >
                        No requests linked. Search above to add one.
                    </div>
                {/if}
            </label>

            <label class="label col-span-4" for="Artifacts">
                <span>Artifacts</span>

                <FileDropzone
                    name="files"
                    multiple
                    on:change={async (e) => {
                        const fileList = e.target.files;
                        if (!fileList.length) return;

                        const newFiles = Array.from(fileList);
                        const validFiles = newFiles.filter((file) => {
                            if (file.size > MAX_FILE_SIZE) {
                                toastStore.trigger({
                                    message: `File too large: ${file.name} (Max 20MB)`,
                                    background: "variant-filled-error",
                                });
                                return false;
                            }
                            return true;
                        });

                        for (const file of validFiles) {
                            testCaseStore
                                .uploadArtifact(testCase.ID, file)
                                .then(() => {
                                    toastStore.trigger({
                                        message: `Artifact uploaded: ${file.name}`,
                                        background: "variant-filled-success",
                                    });
                                })
                                .catch((err) => {
                                    console.error(
                                        `Failed to upload ${file.name}:`,
                                        err,
                                    );
                                    toastStore.trigger({
                                        message: `Error uploading ${file.name}: ${err}`,
                                        background: "variant-filled-error",
                                    });
                                });
                        }
                    }}
                />

                {#if artifacts && artifacts.length > 0}
                    <Accordion>
                        {#each artifacts as art, i (art.ID)}
                            {#if art?.MimeType?.startsWith("image/")}
                                <AccordionItem
                                    regionControl="hover:!bg-tertiary-500/10 transition-colors"
                                    regionCaret="hidden"
                                    disabled={art.Status === "uploading"}
                                    on:click={(e) => {
                                        handleAccordionOpen(art);
                                        handleAccordionScroll(e);
                                    }}
                                >
                                    <svelte:fragment slot="summary">
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
                                                        class="text-tertiary-500"
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

                                            <div class="flex gap-2">
                                                <button
                                                    type="button"
                                                    class="btn-icon btn-icon-sm variant-soft-tertiary"
                                                    disabled={art.Status ===
                                                        "uploading"}
                                                    on:click|stopPropagation={() =>
                                                        downloadArtifact(
                                                            art.ID,
                                                        )}
                                                >
                                                    <Download size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    class="btn-icon btn-icon-sm variant-soft-tertiary shrink-0"
                                                    disabled={art.Status ===
                                                        "uploading"}
                                                    on:click|stopPropagation={() => {
                                                        if (
                                                            art.Status !==
                                                            "uploading"
                                                        ) {
                                                            testCaseStore
                                                                .deleteArtifact(
                                                                    testCase.ID,
                                                                    art.ID,
                                                                )
                                                                .then(() => {
                                                                    toastStore.trigger(
                                                                        {
                                                                            message:
                                                                                "Artifact deleted",
                                                                            background:
                                                                                "variant-filled-success",
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
                                                                })
                                                                .catch(
                                                                    (err) => {
                                                                        console.error(
                                                                            "Delete failed:",
                                                                            err,
                                                                        );
                                                                        toastStore.trigger(
                                                                            {
                                                                                message:
                                                                                    "Failed to delete artifact",
                                                                                background:
                                                                                    "variant-filled-error",
                                                                            },
                                                                        );
                                                                    },
                                                                );
                                                        }
                                                    }}
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </svelte:fragment>

                                    <svelte:fragment slot="content">
                                        <div
                                            class="flex justify-center p-2 bg-surface-900/50 rounded min-h-[100px] items-center border-t border-surface-500/20"
                                        >
                                            {#if imageUrls[art.ID]}
                                                <img
                                                    src={imageUrls[art.ID]}
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
                                    regionControl="hover:!bg-tertiary-500/10 transition-colors"
                                    regionCaret="hidden"
                                    disabled={art.Status === "uploading"}
                                    on:click={(e) => {
                                        handleAccordionOpen(art);
                                        handleAccordionScroll(e);
                                    }}
                                >
                                    <svelte:fragment slot="summary">
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
                                                        class="text-tertiary-500"
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
                                            <div class="flex gap-2">
                                                <button
                                                    type="button"
                                                    class="btn-icon btn-icon-sm variant-soft-tertiary"
                                                    disabled={art.Status ===
                                                        "uploading"}
                                                    on:click|stopPropagation={() =>
                                                        downloadArtifact(
                                                            art.ID,
                                                        )}
                                                >
                                                    <Download size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    class="btn-icon btn-icon-sm variant-soft-tertiary"
                                                    disabled={art.Status ===
                                                        "uploading"}
                                                    on:click|stopPropagation={() => {
                                                        if (
                                                            art.Status !==
                                                            "uploading"
                                                        ) {
                                                            testCaseStore
                                                                .deleteArtifact(
                                                                    testCase.ID,
                                                                    art.ID,
                                                                )
                                                                .then(() => {
                                                                    toastStore.trigger(
                                                                        {
                                                                            message:
                                                                                "Artifact deleted",
                                                                            background:
                                                                                "variant-filled-success",
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
                                                                })
                                                                .catch(
                                                                    (err) => {
                                                                        console.error(
                                                                            "Delete failed:",
                                                                            err,
                                                                        );
                                                                        toastStore.trigger(
                                                                            {
                                                                                message:
                                                                                    "Failed to delete artifact",
                                                                                background:
                                                                                    "variant-filled-error",
                                                                            },
                                                                        );
                                                                    },
                                                                );
                                                        }
                                                    }}
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </svelte:fragment>

                                    <svelte:fragment slot="content">
                                        <div
                                            class="flex justify-center p-2 bg-surface-900/50 rounded min-h-[100px] items-center border-t border-surface-500/20"
                                        >
                                            {#if imageUrls[art.ID]}
                                                <video
                                                    controls
                                                    src={imageUrls[art.ID]}
                                                    class="max-h-[400px] w-auto rounded shadow-xl border border-white/10"
                                                >
                                                    <track kind="captions" />
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
                                                        >Loading video...</span
                                                    >
                                                </div>
                                            {/if}
                                        </div>
                                    </svelte:fragment>
                                </AccordionItem>
                            {:else}
                                <div
                                    class="flex justify-between items-center p-4 py-3 variant-soft rounded-token border-b border-surface-500/10"
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
                                                class="text-tertiary-500"
                                            />
                                        {/if}
                                        <span>{art.Filename}</span>
                                    </div>

                                    <div class="flex gap-2">
                                        <button
                                            type="button"
                                            class="btn-icon btn-icon-sm variant-soft-tertiary"
                                            disabled={art.Status ===
                                                "uploading"}
                                            on:click|stopPropagation={() =>
                                                downloadArtifact(art.ID)}
                                        >
                                            <Download size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            class="btn-icon btn-icon-sm variant-soft-tertiary shrink-0"
                                            disabled={art.Status ===
                                                "uploading"}
                                            on:click|stopPropagation={() => {
                                                if (
                                                    art.Status !== "uploading"
                                                ) {
                                                    testCaseStore
                                                        .deleteArtifact(
                                                            testCase.ID,
                                                            art.ID,
                                                        )
                                                        .then(() => {
                                                            toastStore.trigger({
                                                                message:
                                                                    "Artifact deleted",
                                                                background:
                                                                    "variant-filled-success",
                                                            });
                                                            if (
                                                                imageUrls[
                                                                    art.ID
                                                                ]
                                                            ) {
                                                                URL.revokeObjectURL(
                                                                    imageUrls[
                                                                        art.ID
                                                                    ],
                                                                );
                                                                delete imageUrls[
                                                                    art.ID
                                                                ];
                                                            }
                                                        })
                                                        .catch((err) => {
                                                            console.error(
                                                                "Delete failed:",
                                                                err,
                                                            );
                                                            toastStore.trigger({
                                                                message:
                                                                    "Failed to delete artifact",
                                                                background:
                                                                    "variant-filled-error",
                                                            });
                                                        });
                                                }
                                            }}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            {/if}
                        {/each}
                    </Accordion>
                {:else}
                    <div
                        class="mt-4 p-3 variant-soft rounded-token text-sm opacity-70 text-center"
                    >
                        No artifacts uploaded. Drop files above to attach them.
                    </div>
                {/if}
            </label>
        </form>
    </div>
{/if}
