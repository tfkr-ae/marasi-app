<script>
    import {
        DeleteRepeaterEntry,
        GetRepeaterRequests,
        GetRepeaterTabs,
        GetResponse,
        Repeat,
        UpdateRepeaterEntry,
        GetNote,
        GetMetadata
    } from "../../lib/wailsjs/go/main/App";
    import {
        SlideToggle,
        getModalStore,
    } from "@skeletonlabs/skeleton";
    import { onMount } from "svelte";
    import { SettingsIcon } from "svelte-feather-icons";
    import ContextMenu, { Item, Divider } from "svelte-contextmenu";
    import RequestResponse from "../../lib/components/RequestResponse.svelte";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        ArrowDown,
        ArrowLeft,
        ArrowRight,
        ArrowUp,
        ChevronLeft,
        ChevronRight,
        Lock,
        Pen,
        Play,
        ToggleLeft,
        Trash,
        Send,

        Braces

    } from "lucide-svelte";
    import { Accordion, AccordionItem } from "@skeletonlabs/skeleton";
    import { page } from "$app/stores";
    import {currentLaunchpadIndex, currentLaunchpadRequestIndex, activeProject, proxyItems } from "../../stores";
    import RequestResponseView from "../../lib/components/RequestResponseView.svelte";

    const modalStore = getModalStore();

    // State variables
    let repeaterTabs = [];
    let tabSet = "";
    let items = {};
    let useHttps = true;
    let contextMenu;
    let selectedTab = {};
    let accOpened = false;
    let isLoadingTabs = true;
    let isLoadingRequests = false;
    let previousTabSet = ""; // Track previous tab to detect changes
    let shouldRefreshData = false;
    let shouldJumpToLatest = false; // Flag to track when we should jump to latest entry
    let shouldJumpToLastTab = false; // Flag to track when we should jump to the last tab

    // Computed values
    $: currentItemsList = Object.values(items);
    $: currentItem = currentItemsList.length > $currentLaunchpadRequestIndex ? currentItemsList[$currentLaunchpadRequestIndex] : null;
    $: currentTab = repeaterTabs.length > $currentLaunchpadIndex ? repeaterTabs[$currentLaunchpadIndex] : null;

    // Reset the request index when switching launchpads
    $: if (tabSet && tabSet !== previousTabSet) {
        previousTabSet = tabSet;
    }

    // Watch for URL parameter changes
    $: {
        // Check for last request parameter
        if ($page.url.searchParams.get('last') === '1') {
            shouldJumpToLatest = true;
        }

        // Check for last tab parameter
        if ($page.url.searchParams.get('lastTab') === '1') {
            shouldJumpToLastTab = true;
        }
    }


    $: if ($activeProject) {
        loadCheckpoint();
    }

    function openMetadata() {
        if (!currentItem || !currentItem.Request || !currentItem.Request.ID) return;
        GetNote(currentItem.Request.ID.toString()).then((metadata) => {
            const modal = {
                type: "component",
                component: "Metadata",
                content: metadata,
                title:
                "Request " + ($currentLaunchpadRequestIndex + 1) + " Metadata",
            };
            if (!$modalStore[0]) {
                modalStore.trigger(modal);
            } else if ($modalStore[0].component === "Metadata") {
                modalStore.close();
            }
        });
    }
    function openNotes() {
        if (!currentItem || !currentItem.Request || !currentItem.Request.ID) return;

        GetNote(currentItem.Request.ID.toString()).then((note) => {
            const modal = {
                type: "component",
                component: "Notes",
                title: "Request " + ($currentLaunchpadRequestIndex + 1) + " notes",
                requestID: currentItem.Request.ID,
                content: note,
            };

            if (!$modalStore[0]) {
                shouldRefreshData = true;
                modalStore.trigger(modal);
            } else if ($modalStore[0].component === "Notes") {
                modalStore.close();
            }
        });
    }

    // Launchpad menu options (keyboard shortcuts)
    const launchpadMenu = [
        {
            name: "Toggle Launchpad Settings",
            subtitle: "Toggle Settings Accordian",
            keywords: "settings, toggle",
            icon: ToggleLeft,
            action: {
                handler: () => {
                    accOpened = !accOpened;
                },
                options: { scope: "launchpad", single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        {
            name: "Next Tab",
            subtitle: "Go to next Launchpad tab",
            keywords: "next, tab",
            icon: ArrowRight,
            action: {
                handler: nextTab,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+]", "ctrl+]"],
            },
        },
        {
            name: "Previous Tab",
            subtitle: "Go to previous Launchpad tab",
            keywords: "previous, tab",
            icon: ArrowLeft,
            action: {
                handler: prevTab,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+[", "ctrl+["],
            },
        },
        {
            name: "Next Entry",
            subtitle: "Go to next Launchpad entry",
            keywords: "next, entry, tab",
            icon: ArrowDown,
            action: {
                handler: nextRequest,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+]", "ctrl+⇧+]"],
            },
        },
        {
            name: "Previous Entry",
            subtitle: "Go to previous Launchpad entry",
            keywords: "previous, entry, tab",
            icon: ArrowUp,
            action: {
                handler: prevRequest,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+[", "ctrl+⇧+["],
            },
        },
        {
            name: "Delete Tab",
            subtitle: "Delete Current Launchpad Tab",
            keywords: "delete, tab",
            icon: Trash,
            action: {
                handler: deleteCurrentTab,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+D", "ctrl+⇧+D"],
            },
        },
        {
            name: "Edit Request",
            subtitle: "Edit Current Entry Request",
            keywords: "edit, entry, request",
            icon: Pen,
            action: {
                handler: focusRequestEditor,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+E", "ctrl+⇧+E"],
            },
        },
        {
            name: "Toggle TLS",
            subtitle: "Toggle TLS Flag",
            keywords: "toggle, tls, https",
            icon: Lock,
            action: {
                handler: () => {
                    useHttps = !useHttps;
                },
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+T", "ctrl+⇧+T"],
            },
        },
        {
            name: "Launch",
            subtitle: "Send request through proxy",
            keywords: "send, launchpad, repeat",
            icon: Play,
            action: {
                handler: sendCurrentRequest,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+L", "ctrl+⇧+L"],
            },
        },
        {
            name: "View Notes",
            subtitle: "View or edit request notes",
            keywords: "notes",
            icon: Pen,
            action: {
                handler: openNotes,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+N", "ctrl+⇧+N"],
            },
        },
        {
            name: "View Metadata",
            subtitle: "View request Metadata",
            keywords: "metadata",
            icon: Braces,
            action: {
                handler: openMetadata,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+M", "ctrl+⇧+M"],
            },
        }
    ];

    // Load data when tabSet changes
    $: if (tabSet) {
        loadRequests(tabSet.toString());
    }

    // Navigation functions
    function nextTab() {
        if ($currentLaunchpadIndex < repeaterTabs.length - 1) {
            $currentLaunchpadIndex += 1;
            $currentLaunchpadRequestIndex = 0;
            tabSet = repeaterTabs[$currentLaunchpadIndex].ID;
        }
    }

    function prevTab() {
        if ($currentLaunchpadIndex > 0) {
            $currentLaunchpadIndex -= 1;
            $currentLaunchpadRequestIndex = 0;
            tabSet = repeaterTabs[$currentLaunchpadIndex].ID;
        }
    }

    function nextRequest() {
        const requestsCount = currentItemsList.length;
        if ($currentLaunchpadRequestIndex < requestsCount - 1) {
            $currentLaunchpadRequestIndex += 1;
        }
    }

    function prevRequest() {
        if ($currentLaunchpadRequestIndex > 0) {
            $currentLaunchpadRequestIndex -= 1;
        }
    }

    function deleteCurrentTab() {
        if (!currentTab) return;

        const modal = {
            type: "confirm",
            title: "Deleting " + currentTab.Name,
            body: "Are you sure you wish to proceed?",
            response: (r) => {
                if (r) {
                    DeleteRepeaterEntry(currentTab.ID.toString())
                        .then(() => {
                            GetRepeaterTabs().then((tabs) => {
                                repeaterTabs = tabs ? tabs : [];
                                if (repeaterTabs.length > 0) {
                                    $currentLaunchpadIndex = 0;
                                    tabSet = repeaterTabs[0].ID;
                                }
                            });
                        })
                        .catch((error) => {
                            console.log("Could not delete ", currentTab.Name);
                            console.log(error);
                        });
                }
            },
        };
        modalStore.trigger(modal);
    }

    function focusRequestEditor() {
        const cmContent = document.querySelector('div[data-language="http"]');
        if (cmContent) cmContent.focus();
    }

    function sendCurrentRequest() {
        if (!currentItem || !tabSet) return;

        repeat(
            currentItem.RequestBody,
            tabSet.toString(),
            useHttps
        );
    }

    // API interaction functions
    function repeat(req, tab, useHttps) {
        if (!req || !tab) return;

        isLoadingRequests = true;
        shouldJumpToLatest = true; // Set flag to jump to latest after sending

        Repeat(req, tab.toString(), useHttps).then(() => {
            loadRequests(tabSet.toString());
        });
    }

    function loadRequests(id) {
        if (!id) {
            isLoadingRequests = false;
            return;
        }

        isLoadingRequests = true;
        items = {};

        GetRepeaterRequests(id).then((reqs) => {
            if (reqs && reqs.length > 0) {
                reqs.forEach((req, index) => {
                    items[req.ID] = {
                        Request: {},
                        Response: {},
                        Metadata: {},
                        RequestBody: "",
                    };
                    items[req.ID].Request = req;
                    items[req.ID].Metadata = req.Metadata;
                    GetResponse(req.ID).then((resp) => {
                        items[req.ID].Response = resp;
                    });
                });

                // Handle last=1 and lastTab=1
                if (shouldJumpToLatest || $page.url.searchParams.get('last') === '1') {
                    $currentLaunchpadRequestIndex = reqs.length - 1; // Jump to the last request
                    shouldJumpToLatest = false; // Reset flag
                } else if (previousTabSet !== id) {
                    // For a different tab
                    if ($currentLaunchpadRequestIndex < reqs.length && id === $page.url.searchParams.get('tabId')) {
                        // If we have a stored index for this tab and it's valid, use it
                        $currentLaunchpadRequestIndex = $currentLaunchpadRequestIndex;
                    } else {
                        // Otherwise start at the first request
                        $currentLaunchpadRequestIndex = 0;
                    }
                } else {
                    // Ensure the index is valid for the current tab's request count
                    $currentLaunchpadRequestIndex = Math.min($currentLaunchpadRequestIndex, reqs.length - 1);
                }
            } else {
                // No requests in this tab
                $currentLaunchpadRequestIndex = 0;
            }
            isLoadingRequests = false;
        }).catch(err => {
            console.error("Error loading requests:", err);
            isLoadingRequests = false;
        });
    }
    function loadCheckpoint() {
        isLoadingTabs = true;

        GetRepeaterTabs().then((tabs) => {
            repeaterTabs = tabs ? tabs : [];

            if (repeaterTabs.length > 0) {
                // Handle lastTab=1
                if (shouldJumpToLastTab) {
                    $currentLaunchpadIndex = repeaterTabs.length - 1; // Jump to the last tab
                    shouldJumpToLastTab = false; // Reset flag
                } else if ($currentLaunchpadIndex >= repeaterTabs.length) {
                    $currentLaunchpadIndex = 0; // Fallback if current tab no longer exists
                }

                tabSet = repeaterTabs[$currentLaunchpadIndex].ID;
                selectedTab = repeaterTabs[$currentLaunchpadIndex];
                previousTabSet = tabSet;

                // Load requests for the selected tab
                loadRequests(tabSet.toString());
            }

            isLoadingTabs = false;
        }).catch(err => {
            console.error("Error loading tabs:", err);
            isLoadingTabs = false;
        });
    }
    onMount(() => {
        isLoadingTabs = true;

        // Check for URL parameters on initial load
        const lastParam = $page.url.searchParams.get('last') === '1';
        const lastTabParam = $page.url.searchParams.get('lastTab') === '1';

        if (lastParam) {
            shouldJumpToLatest = true;
        }

        if (lastTabParam) {
            shouldJumpToLastTab = true;
        }

        loadCheckpoint();
    });
</script>

<MarasiKeys scope="launchpad" menuOptions={launchpadMenu} />

<!-- Settings Accordion -->
<Accordion rounded="none">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Launchpad Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <div class="p-4">
                <p class="pb-2">{currentTab ? currentTab?.Description : ""}</p>
                <!-- Add your settings here -->
            </div>
        </svelte:fragment>
    </AccordionItem>
</Accordion>

<!-- Main Content Area -->
<div>
    {#if isLoadingTabs}
        <div class="flex justify-center my-8">
            <div class="spinner"></div>
        </div>
        {:else if repeaterTabs.length === 0}
        <!-- No Launchpads State -->
        <div class="flex flex-col items-center justify-center my-12 text-center">
            <h3 class="text-2xl mb-4">No Launchpads Available</h3>
            <p class="mb-4">Create a launchpad for a request from the Ledger page</p>
        </div>
        {:else if currentTab}
        <!-- Launchpad Navigation -->
        <div class="launchpad-nav">
            <button class="nav-button" on:click={prevTab} disabled={$currentLaunchpadIndex === 0}>
                <ChevronLeft size={24} />
            </button>

            <div class="current-item" on:contextmenu={(e) => {
                selectedTab = currentTab;
                contextMenu.show(e);
            }}>
                <h2 class="text-xl font-bold">{currentTab.Name || 'No Launchpad Selected'}</h2>
                <p class="text-sm opacity-70">{$currentLaunchpadIndex + 1} of {repeaterTabs.length}</p>
            </div>

            <button
                class="nav-button"
                on:click={nextTab}
                disabled={$currentLaunchpadIndex >= repeaterTabs.length - 1}
            >
                <ChevronRight size={24} />
            </button>
        </div>

        <!-- Request Content Area -->
        <div class="request-content-area">
            {#if isLoadingRequests}
                <div class="flex justify-center my-8">
                    <div class="spinner"></div>
                </div>
                {:else if currentItemsList.length === 0}
                <div class="flex flex-col items-center justify-center my-8 text-center">
                    <p class="mb-4">No requests in this launchpad</p>
                    <p class="text-sm opacity-70">Send requests to this launchpad from the History page.</p>
                </div>
                {:else}
                <!-- Request Navigation Bar -->
                <div class="request-nav">
                    <button
                        class="nav-button"
                        on:click={prevRequest}
                        disabled={$currentLaunchpadRequestIndex === 0}
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <div class="current-item">
                        <p class="text-lg">Request {$currentLaunchpadRequestIndex + 1} of {currentItemsList.length}</p>
                    </div>

                    <button
                        class="nav-button"
                        on:click={nextRequest}
                        disabled={$currentLaunchpadRequestIndex >= currentItemsList.length - 1}
                    >
                        <ArrowRight size={20} />
                    </button>
                </div>

                <!-- Current Request/Response Display with Send Controls Inside -->

                <div class="card p-4 bg-surface-800/30 request-card">
                    {#if currentItem}
                        <!-- Send Controls - Centered inside the card -->
                        <div class="flex justify-center items-center mb-4 send-controls w-full">
                            <div class="flex items-center gap-6">
                                <div class="flex items-center">
                                    <span class="mr-2">HTTPS</span>
                                    <SlideToggle
                                        name="slider-label"
                                        bind:checked={useHttps}
                                        />
                                </div>

                                <button
                                    on:click={() => repeat(currentItem.RequestBody, tabSet.toString(), useHttps)}
                                    type="button"
                                    class="btn variant-filled-primary"
                                >
                                    <Send size={16} class="mr-2" /> Send Request
                                </button>
                            </div>
                        </div>

                        <!-- Key technique: Use #key to force component recreation when currentItem changes -->
                        {#key $currentLaunchpadRequestIndex}
                        <RequestResponseView
                            titleText={"Request " + ($currentLaunchpadRequestIndex + 1)}
                            request_id={currentItem?.Request?.ID}
                            requestReadOnly={false}
                            bind:requestBody={currentItem.RequestBody}
                            />
                        {/key}
                        {/if}
                </div>
                {/if}
        </div>
        {/if}
</div>

<!-- Context Menu -->
<ContextMenu bind:this={contextMenu}>
    <Item
        on:click={() => {
            if (selectedTab && selectedTab.ID) {
                DeleteRepeaterEntry(selectedTab.ID.toString()).then(() => {
                    GetRepeaterTabs().then((tabs) => {
                        repeaterTabs = tabs ? tabs : [];
                        if (repeaterTabs.length > 0) {
                            $currentLaunchpadIndex = 0;
                            tabSet = repeaterTabs[0].ID;
                        }
                    });
                });
            }
        }}
    >
        Delete Launchpad
    </Item>
    <Divider></Divider>
    <div data-autoclose="false" class="flex flex-col w-full">
        <div class="p-2">
            <label class="text-sm opacity-70">Launchpad Name</label>
            <input
                on:input={(e) => {
                    if (selectedTab) selectedTab.Name = e.target.value;
                }}
                data-autoclose="false"
                class="input rounded-none w-full mt-1"
                type="text"
                placeholder={selectedTab?.Name || ""}
                value={selectedTab?.Name || ""}
                />
        </div>
        <div class="p-2 pt-0">
            <label class="text-sm opacity-70">Description</label>
            <input
                on:input={(e) => {
                    if (selectedTab) selectedTab.Description = e.target.value;
                }}
                data-autoclose="false"
                class="input rounded-none w-full mt-1"
                type="text"
                placeholder={selectedTab?.Description || ""}
                value={selectedTab?.Description || ""}
                />
        </div>
    </div>
    <div class="flex justify-end w-full mt-2 p-2">
        <button
            type="button"
            class="btn-sm variant-filled-primary"
            on:click={() => {
                if (selectedTab && selectedTab.ID) {
                    UpdateRepeaterEntry(
                        selectedTab.ID.toString(),
                        selectedTab.Name,
                        selectedTab.Description,
                    ).then(() => {
                        GetRepeaterTabs().then((tabs) => {
                            repeaterTabs = tabs ? tabs : [];
                            // Find the index of the current tab in the new list
                            const index = repeaterTabs.findIndex(tab => tab.ID === selectedTab.ID);
                            if (index >= 0) {
                                $currentLaunchpadIndex = index;
                                tabSet = repeaterTabs[index].ID;
                            } else if (repeaterTabs.length > 0) {
                                $currentLaunchpadIndex = 0;
                                tabSet = repeaterTabs[0].ID;
                            }
                        });
                    });
                }
            }}
        >
            Update
        </button>
    </div>
</ContextMenu>

<style>
    /* Navigation styling */
    .launchpad-nav, .request-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 1rem 0;
        background-color: rgba(47, 52, 60, 0.6);
        padding: 1rem;
    }

    .launchpad-nav {
        margin-bottom: 1rem;
    }

    .current-item {
        text-align: center;
        flex: 1;
    }

    .launchpad-nav .current-item {
        cursor: pointer;
    }

    .launchpad-nav .current-item:hover {
        opacity: 0.9;
    }

    .nav-button {
        background: #cf595b;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s;
    }

    .nav-button:hover:not(:disabled) {
        background: #7c3537;
    }

    .nav-button:disabled {
        background: #2f343c;
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Send controls inside card */
    .send-controls {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 0.75rem;
    }

    /* Loading indicator */
    .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-left-color: #cf595b;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    .request-card {
        display: flex;
        flex-direction: column; /* Keep column for overall structure */
        min-height: 200px;
        height: auto !important;
        overflow: visible;
    }

    /* The RequestResponse component should handle row layout internally */
    :global(.request-card > div:not(.send-controls)) {
        display: flex;
        flex: 1;
        overflow: visible;
    }
    /* Utility classes */
</style>
