<script>
    const drawerStore = getDrawerStore();
    const modalStore = getModalStore();
    const toastStore = getToastStore();
    import { goto } from "$app/navigation";
    import { DataHandler } from "@vincjo/datatables";
    import { drawerHeight, filterInput, filterItems, lineWrap, populateHistory, proxyItems, searchInput } from "../../stores";
    import Sort from "../../lib/components/datatables/Sort.svelte";
    import RowCount from "../../lib/components/datatables/RowCount.svelte";
    import RowsPerPage from "../../lib/components/datatables/RowsPerPage.svelte";
    import Pagination from "../../lib/components/datatables/Pagination.svelte";
    import Search from "../../lib/components/datatables/Search.svelte";
    import {
        CreateRepeaterEntry,
        GetNote,
        GetResponse,
        HighlightRow,
        LinkRequestToRepeater,
        SetFilters,
    } from "../../lib/wailsjs/go/main/App";
    import { onMount } from "svelte";
    import {
        Edit2Icon,
        EditIcon,
        FlagIcon,
        SendIcon,
        SettingsIcon,
    } from "svelte-feather-icons";
    import ContextMenu, { Item, Divider } from "svelte-contextmenu";
    import {
        Accordion,
        AccordionItem,
        getDrawerStore,
        getModalStore,
        getToastStore,
        InputChip,
        ListBox,
        ListBoxItem,
    } from "@skeletonlabs/skeleton";
    import { get } from "svelte/store";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        ArrowLeft,
        ArrowRight,
        Braces,
        CodeIcon,
        CopyIcon,
        FilterIcon,
        Maximize,
        Pen,
        Replace,
        SearchIcon,
        SquareArrowOutUpRight,
        ToggleLeftIcon,
        WrapText,
    } from "lucide-svelte";

    let isDrawerOpen = false;
    let selectedId = 0;
    let contextMenu;
    let selectedRow;
    let accOpened = false;
    let menu;
    let drawerMenu = [
        {
            name: "Note",
            subtitle: "Open Request Note",
            icon: Pen,
            keywords: "note",
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        GetNote(selectedId.Request.ID.toString()).then(
                            (note) => {
                                const modal = {
                                    type: "component",
                                    component: "Notes",
                                    title:
                                        "Request " +
                                        (Object.values($proxyItems).indexOf(
                                            selectedId,
                                        ) +
                                            1) +
                                        " notes",
                                    requestID: selectedId.Request.ID,
                                    content: note,
                                };
                                if (!$modalStore[0]) {
                                    modalStore.trigger(modal);
                                } else if ($modalStore[0].component === "Notes") {
                                    modalStore.close();
                                }
                            },
                        );
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+N", "ctrl+⇧+N"],
            },
        },
        {
            name: "Next",
            subtitle: "Go to next request",
            icon: ArrowRight,
            keywords: "next",
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        modalStore.close();
                        const index = $rows.indexOf(selectedId);
                        if (index < $rows.length - 1) {
                            openDrawer($rows[index + 1], true);
                        }
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+]", "ctrl+⇧+]"],
            },
        },
        {
            name: "Previous",
            subtitle: "Go to previous request",
            icon: ArrowLeft,
            keywords: "previous",
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        modalStore.close();
                        const index = $rows.indexOf(selectedId);
                        if (index > 0) {
                            openDrawer($rows[index - 1], true);
                        }
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+[", "ctrl+⇧+["],
            },
        },
        {
            name: "Launchpad",
            subtitle: "Send request to Launchpad",
            icon: SendIcon,
            keywords: "launchpad",
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        const requestIndex =
                            Object.values($proxyItems).indexOf(selectedId) + 1;
                        CreateRepeaterEntry(
                            "Request " + requestIndex,
                            "Launchpad for Request " + requestIndex,
                        ).then((id) => {
                            LinkRequestToRepeater(
                                selectedId.Request.ID,
                                id,
                            ).then(() => {
                                const toastSettings = {
                                    message:
                                        "Request " +
                                        requestIndex +
                                        " sent to Launchpad",
                                    action: {
                                        label: "Jump to Launchpad",
                                        response: () => {
                                            drawerStore.close();
                                            toastStore.close(toastId);
                                            goto("/launchpad?lastTab=1");
                                        },
                                    },
                                };
                                const toastId = toastStore.trigger(toastSettings);
                            });
                        });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+L", "ctrl+⇧+L"],
            },
        },
        {
            name: "Copy URL",
            subtitle: "Copy request URL",
            keywords: "request, url",
            icon: CopyIcon,
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        const url =
                            selectedId.Request.Scheme +
                            "://" +
                            selectedId.Request.Host +
                            selectedId.Request.Path;
                        navigator.clipboard
                            .writeText(url)
                            .then(() => {
                                const toastSettings = {
                                    message: "URL copied to clipboard",
                                    background: "variant-filled-success",
                                };
                                toastStore.trigger(toastSettings);
                            })
                            .catch((err) => {
                                const toastSettings = {
                                    message: "Failed to copy URL",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+U", "ctrl+⇧+U"],
            },
        },
        {
            name: "Copy Request",
            subtitle: "Copy Raw Request",
            keywords: "request, raw",
            icon: CopyIcon,
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        navigator.clipboard
                            .writeText(selectedId.Request.Raw)
                            .then(() => {
                                const toastSettings = {
                                    message: "Request copied to clipboard",
                                    background: "variant-filled-success",
                                };
                                toastStore.trigger(toastSettings);
                            })
                            .catch((err) => {
                                const toastSettings = {
                                    message: "Failed to copy request",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+E", "ctrl+⇧+E"],
            },
        },
        {
            name: "Copy Response",
            subtitle: "Copy Raw Response",
            keywords: "response, raw",
            icon: CopyIcon,
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        navigator.clipboard
                            .writeText($drawerStore?.meta?.response?.Raw)
                            .then(() => {
                                const toastSettings = {
                                    message: "Response copied to clipboard",
                                    background: "variant-filled-success",
                                };
                                toastStore.trigger(toastSettings);
                            })
                            .catch((err) => {
                                const toastSettings = {
                                    message: "Failed to copy response",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+B", "ctrl+⇧+B"],
            },
        },
        {
            name: "Metadata",
            subtitle: "View Metadata for Request / Response",
            keywords: "metadata",
            icon: Braces,
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        const modal = {
                            type: "component",
                            component: "Metadata",
                            content: selectedId.Metadata,
                            title:
                                "Request " +
                                (Object.values($proxyItems).indexOf(
                                    selectedId,
                                ) +
                                    1) +
                                " Metadata",
                        };
                        if (!$modalStore[0]) {
                            modalStore.trigger(modal);
                            console.log($modalStore[0])
                        } else if ($modalStore[0].component === "Metadata") {
                            modalStore.close();
                        }
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+M", "ctrl+⇧+M"],
            },
        },
        {
            name: "Toggle Drawer Height",
            subtitle: "Expand the request response drawer",
            keywords: "toggle, expands",
            icon: Maximize,
            action: {
                handler: () => {
                    if (isDrawerOpen) {
                        if ($drawerHeight === "h-[60%]") {
                            $drawerHeight = "h-[100%]";
                            $drawerStore.height = $drawerHeight;
                        }
                        else {
                            $drawerHeight = "h-[60%]";
                            $drawerStore.height = $drawerHeight;
                        }
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+T", "ctrl+⇧+T"],
            },
        },
        {
            name: "Toggle Line Wrapping",
            subtitle: "Line wrap request & response body",
            keywords: "toggle, linewrap",
            icon: WrapText,
            action: {
                handler: () => {
                  $lineWrap = $lineWrap ? false : true;
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+W", "ctrl+⇧+W"],
            },
        }
    ];
    let ledgerMenu = [
        {
            name: "Toggle Ledger Settings",
            subtitle: "Toggle Settings Accordian",
            keywords: "settings, toggle",
            icon: ToggleLeftIcon,
            action: {
                handler: () => {
                    drawerStore.close();
                    accOpened = !accOpened;
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        {
            name: "Search",
            subtitle: "Jump to search input",
            keywords: "search",
            icon: SearchIcon,
            action: {
                handler: () => {
                    drawerStore.close();
                    if (!accOpened) {
                        accOpened = true;
                    }
                    setTimeout(() => {
                        document.getElementById("searchBox").focus();
                    }, 300);
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+S", "ctrl+⇧+S"],
            },
        },
        {
            name: "Filter",
            subtitle: "Jump to filter input",
            keywords: "filter",
            icon: FilterIcon,
            action: {
                handler: () => {
                    drawerStore.close();
                    if (!accOpened) {
                        accOpened = true;
                    }
                    setTimeout(() => {
                        document
                            .querySelector(
                                'input[placeholder="Filter by Content Type"]',
                            )
                            .focus();
                    }, 300);
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+F", "ctrl+⇧+F"],
            },
        },
        {
            name: "Next",
            subtitle: "Go to next page",
            icon: ArrowRight,
            keywords: "next",
            action: {
                handler: () => {
                    if (!isDrawerOpen) {
                        const pageCount = get(handler.context.pageCount);
                        const pageNumber = get(handler.context.pageNumber);
                        console.log("Page Count: ", pageCount);
                        console.log("Page Number: ", pageNumber);
                        handler.context.pageNumber.update((n) => {
                            if (pageNumber < pageCount) {
                                return n + 1;
                            }
                            return n;
                        });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+]", "ctrl+]"],
            },
        },
        {
            name: "Previous",
            subtitle: "Go to the previous page",
            keywords: "previous",
            icon: ArrowLeft,
            action: {
                handler: () => {
                    if (!isDrawerOpen) {
                        const pageNumber = get(handler.context.pageNumber);
                        console.log("Page Number: ", pageNumber);
                        handler.context.pageNumber.update((n) => {
                            if (pageNumber > 1) {
                                return n - 1;
                            }
                            return n;
                        });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+[", "ctrl+["],
            },
        },
        {
            name: "Open",
            subtitle: "Open Request Drawer",
            keywords: "open",
            icon: SquareArrowOutUpRight,
            action: {
                handler: () => {
                    if (!isDrawerOpen) {
                        new Promise((resolve) => {
                            const modal = {
                                type: "component",
                                component: "MenuInput",
                                title: "Open request",
                                response: (r) => {
                                    resolve(r);
                                },
                            };
                            if (!$modalStore[0]) {
                                modalStore.trigger(modal);
                            } else if ($modalStore[0].component === "MenuInput") {
                                modalStore.close();
                            }
                        }).then((r) => {
                            if (r) {
                                const parsedID = parseInt(r) - 1;
                                if (
                                    parsedID >= 0 &&
                                    parsedID < Object.values($proxyItems).length
                                ) {
                                    const selectedItem =
                                        Object.values($proxyItems)[parsedID];
                                    const rowIndex =
                                        Object.values($rows).indexOf(
                                            selectedItem,
                                        );
                                    if (rowIndex >= 0) {
                                        openDrawer(selectedItem);
                                    }
                                }
                            }
                        });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+O", "ctrl+⇧+O"],
            },
        },
    ];
    function highlightRow(id, color) {
        HighlightRow(id, color)
            .then(() => {
                populateHistory();
            })
            .catch((error) => {
                console.log(error);
            });
    }
    let bad = [];

    const contentFilter2 = (entry, value) => {
        return !value.includes(entry);
    };

    const handler = new DataHandler(Object.values($proxyItems).reverse(), {
        rowsPerPage: 200,
    });
    const rows = handler.getRows();
    $: handler.setRows(Object.values($proxyItems).reverse());

    function openDrawer(row) {
        var requestIndex = Object.values($proxyItems).indexOf(row) + 1
        GetResponse(row.Request.ID).then((response) => {
            const drawerSettings = {
                id: "request-response",
                meta: {
                    metadata: row.Metadata,
                    request: row.Request,
                    response: response,
                    requestIndex: requestIndex,
                },
                height: $drawerHeight,
                width: "w-full",
                position: "bottom"
            };
            selectedId = row;
            drawerStore.open(drawerSettings);
        });
    }

    function reselect() {
        // We have a request selected, let's update
        if (selectedId) {
            selectedId = $proxyItems[selectedId?.Request?.ID];
            console.log(selectedId)
        }
    }
    $: if ($proxyItems) {
        reselect();
    }
    onMount(() => {
        handler.filter(
            $filterItems,
            (row) => row.Response.ContentType,
            contentFilter2,
        );
        handler.search($searchInput);
        const unsubscribe = drawerStore.subscribe((settings) => {
            isDrawerOpen = settings.open ? settings.open : false;
            if (isDrawerOpen) menu.menuOptions = drawerMenu;
            else menu.menuOptions = ledgerMenu;
        });
        return () => {
            // ninjaMenu.clear();
            isDrawerOpen = false;
            unsubscribe();
        };
    });
</script>

<MarasiKeys bind:this={menu} scope="ledger" menuOptions={ledgerMenu} />
<Accordion rounded="none">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Ledger Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <footer class="flex justify-between">
                <Search bind:value={$searchInput} id="searchBox" {handler} />
                <RowsPerPage {handler} />
                <RowCount {handler} />
                <Pagination {handler} />
            </footer>
            <InputChip
                bind:input={$filterInput}
                bind:value={$filterItems}
                name="chips"
                placeholder="Filter by Content Type"
                rounded="none"
                on:add={() => {
                    SetFilters($filterItems);
                    handler.filter(
                        $filterItems,
                        (row) => row.Response.ContentType,
                        contentFilter2,
                    );
                }}
                on:remove={() => {
                    SetFilters($filterItems);
                    handler.filter(
                        $filterItems,
                        (row) => row.Response.ContentType,
                        contentFilter2,
                    );
                }}
            ></InputChip>
        </svelte:fragment>
    </AccordionItem>
</Accordion>

<div class="no-select table-container">
    <table class="table table-auto w-full">
        <thead>
            <tr>
                <!-- Use th for headers and ensure they are centered -->
                <th>
                    <Sort {handler} orderBy={(row) => row.Request.ID}>ID</Sort>
                </th>
                <th>Host</th>
                <th>Method</th>
                <th>Path</th>
                <th>Content Type</th>
                <th>Content Length</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            {#each $rows as row}
                <tr
                    style="background-color: {row.Metadata?.Highlight}"
                    on:contextmenu={(e) => {
                        selectedRow = row;
                        contextMenu.show(e);
                    }}
                    on:click={() => {
                        openDrawer(row);
                    }}
                >
                    <td class="id-cell">
                        <div class="id-container">
                            <span
                                >{Object.values($proxyItems).indexOf(row) +
                                    1}</span
                            >
                            {#if Object.keys(row.Metadata).length > 0}
                                <div class="icon-row text-secondary-500">
                                    {#if row.Metadata.launchpad}<SendIcon
                                            size="10"
                                        />{/if}
                                    {#if row.Metadata.intercepted}<FlagIcon
                                            size="10"
                                        />{/if}
                                    {#if row.Metadata.intercepted && "original-request" in row.Metadata && row.Metadata["original-request"] !== row.Request.Raw}
                                        <EditIcon size="10" />
                                    {/if}
                                    {#if row.Metadata.intercepted && "original-response" in row.Metadata && row.Metadata["original-response"] !== row.Response.Raw}
                                        <EditIcon size="10" />
                                    {/if}
                                    {#if row.Metadata.has_note && row.Metadata.has_note == 1}<Edit2Icon
                                            size="10"
                                        />{/if}
                                    {#if row.Metadata.override_host}<Replace size="10"/>{/if}
                                </div>
                            {/if}
                        </div>
                    </td>
                    <td class="host-cell" title={row.Request.Host}
                        >{row.Request.Host}</td
                    >
                    <td class="method-cell">{row.Request.Method}</td>
                    <td class="path-cell" title={row.Request.Path}
                        >{row.Request.Path}</td
                    >
                    <td class="ctype-cell">{row.Response.ContentType}</td>
                    <td class="clength-cell">{row.Response.Length}</td>
                    <td class="status-cell">{row.Response.Status}</td>
                </tr>
            {/each}
        </tbody>
    </table>
</div>

<ContextMenu bind:this={contextMenu}>
    <Item
        on:click={() => {
            GetNote(selectedRow.Request.ID.toString()).then((note) => {
                const modal = {
                    type: "component",
                    component: "Notes",
                    title:
                        "Request " +
                        (Object.values($proxyItems).indexOf(selectedRow) + 1) +
                        " notes",
                    requestID: selectedRow.Request.ID,
                    content: note,
                };
                if (!$modalStore[0]) {
                    modalStore.trigger(modal);
                }
            });
        }}
    >
        Open Note
    </Item>
    <Item
        on:click={() => {
            const requestIndex =
                Object.values($proxyItems).indexOf(selectedRow) + 1;
                CreateRepeaterEntry(
                    "Request " + requestIndex,
                    "Launchpad for Request " + requestIndex,
                ).then((id) => {
                    LinkRequestToRepeater(selectedRow.Request.ID, id).then(() => {
                        const toastSettings = {
                            message:
                                "Request " +
                                requestIndex +
                                " sent to Launchpad",
                            action: {
                                label: "Jump to Launchpad",
                                response: () => {
                                    drawerStore.close();
                                    toastStore.close(toastId);
                                    goto("/launchpad?lastTab=1");
                                },
                            },
                        };
                        const toastId = toastStore.trigger(toastSettings);
                    });
                });
        }}>Send to Launchpad</Item
    >
    <Divider />
    <ListBox active="hover:variant-soft">
        <ListBoxItem
            on:click={() => highlightRow(selectedRow.Request.ID, 15680580)}
            class="bg-red-500">Red</ListBoxItem
        >
        <ListBoxItem
            on:click={() => highlightRow(selectedRow.Request.ID, 2278750)}
            class="bg-green-500">Green</ListBoxItem
        >
        <ListBoxItem
            on:click={() => highlightRow(selectedRow.Request.ID, 15381256)}
            class="bg-yellow-500">Yellow</ListBoxItem
        >
        <ListBoxItem
            on:click={() => highlightRow(selectedRow.Request.ID, 3900150)}
            class="bg-blue-500">Blue</ListBoxItem
        >
        <ListBoxItem
            on:click={() => highlightRow(selectedRow.Request.ID, 11032055)}
            class="bg-purple-500">Purple</ListBoxItem
        >
        <ListBoxItem on:click={() => highlightRow(selectedRow.Request.ID, -1)}
            >None</ListBoxItem
        >
    </ListBox>
</ContextMenu>

<style>
    /* Make the header centered and clean */
    thead th {
        text-align: center;
        padding: 4px;
        line-height: normal;
        border-bottom: 1px solid #cf595b;
        white-space: nowrap;
    }

    /* General table styling */
    .table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.9rem;
    }

    tbody td {
        vertical-align: middle;
        padding: 4px;
        line-height: 0.8;
        border-bottom: 1px solid #2f343c;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Make all columns except path fit contents minimally */
    /* path-cell will expand as needed */
    .id-cell,
    .method-cell,
    .ctype-cell,
    .clength-cell,
    .status-cell {
        width: 1%; /* Forces these columns to shrink to fit content */
        text-align: center; /* Center their content */
        padding: 0.5em;
    }

    .host-cell {
        text-align: left;
        max-width: 10em;
        width: 10em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    /* Path cell takes remaining space */
    .path-cell {
        width: auto; /* Expands to fill remaining space */
        max-width: 50em;
    }

    /* ID container: center its contents */
    .id-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25em; /* smaller gap */
    }

    /* Icons row: minimal spacing */
    .icon-row {
        display: flex;
        gap: 0.25em;
        margin: 0;
        padding: 0;
    }

    .icon-row:empty {
        display: none;
    }

    /* Additional cleanup */
    .select {
        margin-top: 0.5em;
    }

    .table-container {
        /* Add any container styling if needed */
    }

    tbody tr:hover {
        background-color: #2f343c;
        cursor: pointer;
    }
</style>
