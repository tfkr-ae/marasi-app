<script>
    import { goto } from "$app/navigation";
    import {
        createSvelteTable,
        getCoreRowModel,
        getPaginationRowModel,
        getFilteredRowModel,
        getSortedRowModel,
        flexRender,
        createColumnHelper,
        renderComponent,
    } from "@tanstack/svelte-table";
    import {
        drawerHeight,
        proxyItems,
        searchInput,
        sorting,
        pagination,
        contentTypeFilter,
        contentTypeFilterInput,
        lineWrap,
    } from "../../stores";
    import { derived } from "svelte/store";
    import ContextMenu, { Item, Divider } from "svelte-contextmenu";
    import {
        getDrawerStore,
        getModalStore,
        getToastStore,
        Accordion,
        AccordionItem,
        InputChip,
        ListBoxItem,
        ListBox,
    } from "@skeletonlabs/skeleton";
    import {
        Search,
        ChevronLeft,
        ChevronRight,
        ChevronsLeft,
        ChevronsRight,
        SettingsIcon,
        ToggleLeftIcon,
        SearchIcon,
        FilterIcon,
        ArrowRightIcon,
        ArrowLeftIcon,
        SquareArrowUpRightIcon,
        PenIcon,
        SendIcon,
        CopyIcon,
        BracesIcon,
        MaximizeIcon,
        WrapTextIcon,
    } from "lucide-svelte";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import IDCell from "../../lib/components/IDCell.svelte";
    import {
        CreateLaunchpadEntry,
        GetMetadata,
        GetNote,
        GetRawDetails,
        HighlightRow,
        LinkRequestToLaunchpad,
        SetFilters,
    } from "../../lib/wailsjs/go/main/App";
    import { onMount } from "svelte";

    const drawerStore = getDrawerStore();
    const modalStore = getModalStore();
    const toastStore = getToastStore();
    let accOpened = false;
    let drawerOpened = false;
    let menu = [];
    let contextMenu;
    let selectedRow;

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
                    accOpened = !accOpened;
                    setTimeout(() => {
                        const searchBox = document.getElementById("searchBox");
                        if (document.activeElement === searchBox) {
                            searchBox.blur();
                        } else {
                            searchBox.focus();
                        }
                    }, 10);
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+S", "ctrl+��+S"],
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
                    accOpened = !accOpened;
                    setTimeout(() => {
                        const filterBox = document.querySelector(
                            'input[placeholder="Filter by Content Type"]',
                        );
                        if (document.activeElement === filterBox) {
                            filterBox.blur();
                        } else {
                            filterBox.focus();
                        }
                    }, 10);
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+F", "ctrl+⇧+F"],
            },
        },
        {
            name: "Next",
            subtitle: "Go to next page",
            icon: ArrowRightIcon,
            keywords: "next",
            action: {
                handler: () => {
                    if (!drawerOpened && $table.getCanNextPage()) {
                        $table.nextPage();
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
            icon: ArrowLeftIcon,
            action: {
                handler: () => {
                    if (!drawerOpened && $table.getCanPreviousPage()) {
                        $table.previousPage();
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
            icon: SquareArrowUpRightIcon,
            action: {
                handler: () => {
                    if (!drawerOpened) {
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
                            } else if (
                                $modalStore[0].component === "MenuInput"
                            ) {
                                modalStore.close();
                            }
                        }).then((requestIndex) => {
                            if (!requestIndex) return;
                            const targetIndex = parseInt(requestIndex) - 1;
                            const rows = $table.getCoreRowModel().rows;
                            if (rows[targetIndex]) {
                                const row = rows[targetIndex];
                                openDrawer(row.original, targetIndex + 1);
                            }
                        });
                    }
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+O", "ctrl+⇧+O"],
            },
        },
    ];
    let drawerMenu = [
        {
            name: "Note",
            subtitle: "Open Request Note",
            icon: PenIcon,
            keywords: "note",
            action: {
                handler: () => {
                    if (drawerOpened) {
                        GetNote($drawerStore?.meta?.request?.ID).then(
                            (note) => {
                                const modal = {
                                    type: "component",
                                    component: "Notes",
                                    title:
                                        "Request " +
                                        $drawerStore?.meta?.requestIndex +
                                        " notes",
                                    requestID: $drawerStore?.meta?.request?.ID,
                                    content: note,
                                };
                                if (!$modalStore[0]) {
                                    modalStore.trigger(modal);
                                } else if (
                                    $modalStore[0].component === "Notes"
                                ) {
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
            icon: ArrowRightIcon,
            keywords: "next",
            action: {
                handler: () => {
                    if (drawerOpened) {
                        modalStore.close();
                        const rows = $table.getRowModel().rows;
                        const isFiltered = $drawerStore?.meta?.isFiltered;
                        const filteredIndex = $drawerStore?.meta?.filteredIndex;

                        let nextIndex = -1;

                        if (isFiltered) {
                            if (rows.length > 0) nextIndex = 0;
                        } else {
                            if (filteredIndex < rows.length - 1) {
                                nextIndex = filteredIndex + 1;
                            }
                        }

                        if (nextIndex !== -1) {
                            const row = rows[nextIndex];
                            openDrawer(row.original, row.index + 1);
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
            icon: ArrowLeftIcon,
            keywords: "previous",
            action: {
                handler: () => {
                    if (drawerOpened) {
                        modalStore.close();
                        const rows = $table.getRowModel().rows;
                        const isFiltered = $drawerStore?.meta?.isFiltered;
                        const filteredIndex = $drawerStore?.meta?.filteredIndex;

                        let prevIndex = -1;

                        if (isFiltered) {
                            if (rows.length > 0) prevIndex = rows.length - 1;
                        } else {
                            if (filteredIndex > 0) {
                                prevIndex = filteredIndex - 1;
                            }
                        }

                        if (prevIndex !== -1) {
                            const row = rows[prevIndex];
                            openDrawer(row.original, row.index + 1);
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
                    if (drawerOpened) {
                        const index = $drawerStore?.meta?.requestIndex;
                        CreateLaunchpadEntry(
                            "Request " + index,
                            "Launchpad for Request " + index,
                        ).then((id) => {
                            LinkRequestToLaunchpad(
                                $drawerStore?.meta?.request?.ID,
                                id,
                            ).then(() => {
                                const toastSettings = {
                                    message:
                                        "Request " +
                                        index +
                                        " sent to Launchpad",
                                    action: {
                                        label: "Jump to Launchpad",
                                        response: () => {
                                            drawerStore.close();
                                            toastStore.close(toastId);
                                            goto("/launchpad?id=" + id);
                                        },
                                    },
                                };
                                const toastId =
                                    toastStore.trigger(toastSettings);
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
                    if (drawerOpened) {
                        const url =
                            $drawerStore?.meta?.request?.Scheme +
                            "://" +
                            $drawerStore?.meta?.request?.Host +
                            $drawerStore?.meta?.request?.Path;
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
                    if (drawerOpened) {
                        navigator.clipboard
                            .writeText($drawerStore?.meta?.request?.Raw)
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
                    if (drawerOpened) {
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
            icon: BracesIcon,
            action: {
                handler: () => {
                    if (drawerOpened) {
                        GetMetadata($drawerStore?.meta?.request?.ID).then(
                            (metadata) => {
                                const modal = {
                                    type: "component",
                                    component: "Metadata",
                                    content: metadata,
                                    title:
                                        "Request " +
                                        $drawerStore?.meta?.requestIndex +
                                        " Metadata",
                                };
                                if (!$modalStore[0]) {
                                    modalStore.trigger(modal);
                                } else if (
                                    $modalStore[0].component === "Metadata"
                                ) {
                                    modalStore.close();
                                }
                            },
                        );
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
            icon: MaximizeIcon,
            action: {
                handler: () => {
                    if (drawerOpened) {
                        if ($drawerHeight === "h-[60%]") {
                            $drawerHeight = "h-[100%]";
                            $drawerStore.height = $drawerHeight;
                        } else {
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
            icon: WrapTextIcon,
            action: {
                handler: () => {
                    $lineWrap = $lineWrap ? false : true;
                },
                options: { scope: "ledger", single: true },
                keys: ["⌘+⇧+W", "ctrl+⇧+W"],
            },
        },
    ];

    const columnHelper = createColumnHelper();
    const columns = [
        columnHelper.accessor("ID", {
            header: "ID",
            cell: (info) =>
                renderComponent(IDCell, {
                    index: info.row.index + 1,
                    row: info.row.original,
                }),
            sortingFn: "text",
            meta: {
                classes: "centered-cell",
            },
        }),
        columnHelper.accessor("Host", {
            header: "Host",
            meta: {
                classes: "host-cell",
            },
        }),
        columnHelper.accessor("Method", {
            header: "Method",
            meta: {
                classes: "centered-cell",
            },
        }),
        columnHelper.accessor("Path", {
            header: "Path",
            meta: {
                classes: "path-cell",
            },
        }),
        columnHelper.accessor("ContentType", {
            header: "Content Type",
            meta: {
                classes: "centered-cell",
            },
            filterFn: (row, id, filterValue) => {
                if (!filterValue || filterValue.length === 0) return true;
                const rowValue = row.getValue(id);
                return !filterValue.includes(rowValue);
            },
        }),
        columnHelper.accessor("Length", {
            header: "Content Length",
            meta: {
                classes: "centered-cell",
            },
        }),
        columnHelper.accessor("Status", {
            header: "Status",
            meta: {
                classes: "centered-cell",
            },
        }),
    ];

    const setSorting = (updater) => {
        sorting.update((old) =>
            updater instanceof Function ? updater(old) : updater,
        );
    };

    const setPagination = (updater) => {
        pagination.update((old) =>
            updater instanceof Function ? updater(old) : updater,
        );
    };

    const setGlobalFilter = (updater) => {
        searchInput.update((old) =>
            updater instanceof Function ? updater(old) : updater,
        );
    };

    const options = derived(
        [proxyItems, sorting, pagination, searchInput, contentTypeFilter],
        ([$data, $sorting, $pagination, $globalFilter, $contentTypeFilter]) => {
            const currentFilters = [];

            if ($contentTypeFilter?.length) {
                currentFilters.push({
                    id: "ContentType",
                    value: $contentTypeFilter,
                });
            }
            return {
                data: $data,
                columns,
                autoResetPageIndex: false,
                state: {
                    sorting: $sorting,
                    pagination: $pagination,
                    globalFilter: $globalFilter ?? "",
                    columnFilters: currentFilters,
                },
                onSortingChange: setSorting,
                onPaginationChange: setPagination,
                onGlobalFilterChange: setGlobalFilter,
                getCoreRowModel: getCoreRowModel(),
                getSortedRowModel: getSortedRowModel(),
                getPaginationRowModel: getPaginationRowModel(),
                getFilteredRowModel: getFilteredRowModel(),
                enableGlobalFilter: true,
            };
        },
    );

    const table = createSvelteTable(options);

    function isFiltered(id) {
        return !$table.getRowModel().rows.find((row) => row.original.ID === id);
    }

    function filteredIndex(id) {
        return $table
            .getRowModel()
            .rows.findIndex((row) => row.original.ID === id);
    }

    function openDrawer(row, index) {
        GetRawDetails(row.ID).then((requestResponse) => {
            const drawerSettings = {
                id: "request-response",
                meta: {
                    metadata: requestResponse.Metadata,
                    request: requestResponse.Request,
                    response: requestResponse.Response,
                    requestIndex: index,
                    filteredIndex: filteredIndex(row.ID),
                    isFiltered: isFiltered(row.ID),
                },
                height: $drawerHeight,
                width: "w-full",
                position: "bottom",
            };
            drawerStore.open(drawerSettings);
        });
    }
    onMount(() => {
        const unsubscribe = drawerStore.subscribe((settings) => {
            drawerOpened = settings.open ? settings.open : false;
            if (drawerOpened) menu.menuOptions = drawerMenu;
            else menu.menuOptions = ledgerMenu;
        });
        return () => {
            drawerOpened = false;
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
            <div class="flex flex-col gap-4 p-2">
                <div
                    class="input-group input-group-divider grid-cols-[auto_1fr_auto]"
                >
                    <div class="input-group-shim"><Search size={16} /></div>
                    <input
                        id="searchBox"
                        type="search"
                        placeholder="Search..."
                        bind:value={$searchInput}
                        on:input={() => {
                            setPagination((old) => ({ ...old, pageIndex: 0 }));
                            setGlobalFilter($searchInput);
                        }}
                    />
                </div>
                <InputChip
                    bind:input={$contentTypeFilterInput}
                    bind:value={$contentTypeFilter}
                    name="chips"
                    placeholder="Filter by Content Type"
                    rounded="none"
                    on:add={() => {
                        setPagination((old) => ({ ...old, pageIndex: 0 }));
                        SetFilters($contentTypeFilter);
                    }}
                    on:remove={() => {
                        setPagination((old) => ({ ...old, pageIndex: 0 }));
                        SetFilters($contentTypeFilter);
                    }}
                ></InputChip>

                <div
                    class="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                    <div class="flex items-center gap-2">
                        <span class="opacity-70">Rows per page:</span>
                        <select
                            class="select select-sm w-20"
                            value={$pagination.pageSize}
                            on:change={(e) => {
                                const val = e.target.value
                                    ? Number(e.target.value)
                                    : 10;
                                setPagination((old) => ({
                                    ...old,
                                    pageSize: val,
                                }));
                            }}
                        >
                            {#each [10, 20, 30, 40, 50, 100] as pageSize}
                                <option value={pageSize}>{pageSize}</option>
                            {/each}
                        </select>
                    </div>

                    <div class="flex items-center gap-2">
                        <span class="opacity-70">
                            Page {$table.getState().pagination.pageIndex + 1} of
                            {$table.getPageCount().toLocaleString()}
                        </span>

                        <div
                            class="btn-group variant-filled-surface btn-group-sm"
                        >
                            <button
                                disabled={!$table.getCanPreviousPage()}
                                on:click={() => $table.setPageIndex(0)}
                                title="First Page"
                            >
                                <ChevronsLeft size={16} />
                            </button>
                            <button
                                disabled={!$table.getCanPreviousPage()}
                                on:click={() => $table.previousPage()}
                                title="Previous Page"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                disabled={!$table.getCanNextPage()}
                                on:click={() => $table.nextPage()}
                                title="Next Page"
                            >
                                <ChevronRight size={16} />
                            </button>
                            <button
                                disabled={!$table.getCanNextPage()}
                                on:click={() =>
                                    $table.setPageIndex(
                                        $table.getPageCount() - 1,
                                    )}
                                title="Last Page"
                            >
                                <ChevronsRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </svelte:fragment>
    </AccordionItem>
</Accordion>

<div class="no-select font-mono text-xs">
    <table class="table table-hover">
        <thead>
            {#each $table.getHeaderGroups() as hg}
                <tr>
                    {#each hg.headers as header}
                        <th colSpan={header.colSpan}>
                            {#if !header.isPlaceholder}
                                <div
                                    class:cursor-pointer={header.column.getCanSort()}
                                    class:select-none={header.column.getCanSort()}
                                    on:click={header.column.getToggleSortingHandler()}
                                    on:keydown
                                    role="button"
                                    tabindex="0"
                                >
                                    <svelte:component
                                        this={flexRender(
                                            header.column.columnDef.header,
                                            header.getContext(),
                                        )}
                                    />
                                    {#if header.column.getIsSorted() === "asc"}
                                        &uarr;
                                    {:else if header.column.getIsSorted() === "desc"}
                                        &darr;
                                    {/if}
                                </div>
                            {/if}
                        </th>
                    {/each}
                </tr>
            {/each}
        </thead>
        <tbody>
            {#each $table.getRowModel().rows as row}
                <tr
                    style="background-color: {row.original.Metadata
                        ?.highlight ?? ''}"
                    on:click={() => {
                        openDrawer(row.original, row.index + 1);
                    }}
                    on:contextmenu={(e) => {
                        selectedRow = row;
                        contextMenu.show(e);
                    }}
                >
                    {#each row.getVisibleCells() as cell}
                        <td class={cell.column.columnDef.meta?.classes ?? ""}>
                            <svelte:component
                                this={flexRender(
                                    cell.column.columnDef.cell,
                                    cell.getContext(),
                                )}
                            />
                        </td>
                    {/each}
                </tr>
            {/each}
        </tbody>
    </table>
</div>

<ContextMenu bind:this={contextMenu}>
    <Item
        on:click={() => {
            GetNote(selectedRow.original.ID).then((note) => {
                const modal = {
                    type: "component",
                    component: "Notes",
                    title: "Request " + (selectedRow.index + 1) + " notes",
                    requestID: selectedRow.original.ID,
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
            const index = selectedRow.index + 1;
            CreateLaunchpadEntry(
                "Request " + index,
                "Launchpad for Request " + index,
            ).then((id) => {
                LinkRequestToLaunchpad(selectedRow.original.ID, id).then(() => {
                    const toastSettings = {
                        message: "Request " + index + " sent to Launchpad",
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
            group
            name
            value
            on:click={() => {
                const color = 15680580;
                HighlightRow(selectedRow.original.ID, color).then(() => {
                    $proxyItems[selectedRow.index].Metadata["highlight"] =
                        "#" + color.toString(16).padStart(6, "0");
                });
            }}
            class="bg-red-500">Red</ListBoxItem
        >
        <ListBoxItem
            group
            name
            value
            on:click={() => {
                const color = 2278750;
                HighlightRow(selectedRow.original.ID, color).then(() => {
                    $proxyItems[selectedRow.index].Metadata["highlight"] =
                        "#" + color.toString(16).padStart(6, "0");
                });
            }}
            class="bg-green-500">Green</ListBoxItem
        >
        <ListBoxItem
            group
            name
            value
            on:click={() => {
                const color = 15381256;
                HighlightRow(selectedRow.original.ID, color).then(() => {
                    $proxyItems[selectedRow.index].Metadata["highlight"] =
                        "#" + color.toString(16).padStart(6, "0");
                });
            }}
            class="bg-yellow-500">Yellow</ListBoxItem
        >
        <ListBoxItem
            group
            name
            value
            on:click={() => {
                const color = 3900150;
                HighlightRow(selectedRow.original.ID, color).then(() => {
                    $proxyItems[selectedRow.index].Metadata["highlight"] =
                        "#" + color.toString(16).padStart(6, "0");
                });
            }}
            class="bg-blue-500">Blue</ListBoxItem
        >
        <ListBoxItem
            group
            name
            value
            on:click={() => {
                const color = 11032055;
                HighlightRow(selectedRow.original.ID, color).then(() => {
                    $proxyItems[selectedRow.index].Metadata["highlight"] =
                        "#" + color.toString(16).padStart(6, "0");
                });
            }}
            class="bg-purple-500">Purple</ListBoxItem
        >
        <ListBoxItem
            group
            name
            value
            on:click={() => {
                HighlightRow(selectedRow.original.ID, -1).then(() => {
                    $proxyItems[selectedRow.index].Metadata["highlight"] = "";
                });
            }}>None</ListBoxItem
        >
    </ListBox>
</ContextMenu>

<style>
    thead th {
        text-align: center;
        line-height: normal;
        white-space: nowrap;
        border-bottom: 1px solid rgb(var(--color-primary-500));
    }
    .table {
        border-collapse: collapse;
        width: 100%;
        font-size: 1rem;
    }
    tbody td {
        vertical-align: middle;
        padding: 0.25rem;
        line-height: 1rem;
        border-bottom: 1px solid rgb(var(--color-surface-500));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .centered-cell {
        width: 1em;
        text-align: center;
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

    .path-cell {
        width: auto;
        max-width: 15em;
    }
</style>
