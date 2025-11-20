<script>
    const drawerStore = getDrawerStore();
    const modalStore = getModalStore();
    const toastStore = getToastStore();
    import { goto } from "$app/navigation";
    import { onMount, tick } from "svelte";
    import { get } from "svelte/store";
    import { DataHandler } from "@vincjo/datatables";
    import {
        drawerHeight,
        httpqlQuery,
        lineWrap,
        populateHistory,
        proxyItems,
        requestFilterSelections,
        requestFilters,
        searchInput,
    } from "../../stores";
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
    } from "../../lib/wailsjs/go/main/App";
    import { compileHttpql } from "../../lib/utils/httpql";
    import ContextMenu, { Item, Divider } from "svelte-contextmenu";
    import {
        Accordion,
        AccordionItem,
        getDrawerStore,
        getModalStore,
        getToastStore,
        ListBox,
        ListBoxItem,
    } from "@skeletonlabs/skeleton";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        ArrowLeft,
        ArrowRight,
        Braces,
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
    import {
        Edit2Icon,
        EditIcon,
        FlagIcon,
        SendIcon,
        SettingsIcon,
    } from "svelte-feather-icons";

    const HTTPQL_COMPLETIONS = (() => {
        const primaryFields = [
            {
                prefix: "request",
                children: [
                    "method",
                    "host",
                    "path",
                    "scheme",
                    "query",
                    "body",
                    "headers",
                    "params",
                    "cookies",
                    "raw",
                ],
            },
            {
                prefix: "response",
                children: [
                    "status",
                    "statustext",
                    "contenttype",
                    "length",
                    "headers",
                    "body",
                    "raw",
                ],
            },
            {
                prefix: "metadata",
                children: ["*", "intercepted", "launchpad", "highlight"],
            },
        ];
        const standalone = [
            "method",
            "host",
            "path",
            "scheme",
            "status",
            "statustext",
            "contenttype",
            "ctype",
            "length",
            "body",
            "query",
            "url",
            "requestbody",
            "responsebody",
            "contains",
            "matches",
        ];
        const helpers = ["hasBase64Url(", "reflects(", "AND", "OR", "NOT"];
        const completions = new Set();
        primaryFields.forEach(({ prefix, children }) => {
            completions.add(prefix);
            children.forEach((child) => completions.add(`${prefix}.${child}`));
        });
        standalone.forEach((entry) => completions.add(entry));
        helpers.forEach((entry) => completions.add(entry));
        return Array.from(completions);
    })();

    let isDrawerOpen = false;
    let selectedId = 0;
    let contextMenu;
    let selectedRow;
    let accOpened = false;
    let menu;
    let highlightAssignments = new Map();
    let httpqlCompilation = compileHttpql("");
    let httpqlError = "";
    let filterMap = new Map();
    let compiledFilters = new Map();
    let filterErrorMap = new Map();
    let selectionSummary = [];
    let activeFilterIds = new Set();
    let selectionMap = new Map();
    let filterCardSummaries = [];
    let httpqlInputEl;
    let httpqlSuggestions = [];
    let suggestionPrefix = "";
    let suggestionVisible = false;
    let activeSuggestionIndex = 0;
    let lastSuggestionRange = null;
    let suppressSuggestionUpdate = false;

    const handler = new DataHandler(Object.values($proxyItems).reverse(), {
        rowsPerPage: 200,
    });
    const rows = handler.getRows();

    const drawerMenu = [
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
                                } else if (
                                    $modalStore[0].component === "Notes"
                                ) {
                                    modalStore.close();
                                }
                            },
                        );
                    }
                },
                options: { scope: "requests", single: true },
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
                options: { scope: "requests", single: true },
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
                options: { scope: "requests", single: true },
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
                                const toastId =
                                    toastStore.trigger(toastSettings);
                            });
                        });
                    }
                },
                options: { scope: "requests", single: true },
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
                            .catch(() => {
                                const toastSettings = {
                                    message: "Failed to copy URL",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }
                },
                options: { scope: "requests", single: true },
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
                            .catch(() => {
                                const toastSettings = {
                                    message: "Failed to copy request",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }
                },
                options: { scope: "requests", single: true },
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
                            .catch(() => {
                                const toastSettings = {
                                    message: "Failed to copy response",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }
                },
                options: { scope: "requests", single: true },
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
                        } else if ($modalStore[0].component === "Metadata") {
                            modalStore.close();
                        }
                    }
                },
                options: { scope: "requests", single: true },
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
                        } else {
                            $drawerHeight = "h-[60%]";
                            $drawerStore.height = $drawerHeight;
                        }
                    }
                },
                options: { scope: "requests", single: true },
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
                options: { scope: "requests", single: true },
                keys: ["⌘+⇧+W", "ctrl+⇧+W"],
            },
        },
    ];

    const requestsMenu = [
        {
            name: "Toggle Settings",
            subtitle: "Toggle settings accordion",
            keywords: "settings, toggle",
            icon: ToggleLeftIcon,
            action: {
                handler: () => {
                    drawerStore.close();
                    accOpened = !accOpened;
                },
                options: { scope: "requests", single: true },
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
                options: { scope: "requests", single: true },
                keys: ["⌘+⇧+S", "ctrl+⇧+S"],
            },
        },
        {
            name: "HTTPQL",
            subtitle: "Focus HTTPQL query",
            keywords: "filter",
            icon: FilterIcon,
            action: {
                handler: () => {
                    drawerStore.close();
                    if (!accOpened) {
                        accOpened = true;
                    }
                    setTimeout(() => {
                        document.getElementById("httpqlInput")?.focus();
                    }, 300);
                },
                options: { scope: "requests", single: true },
                keys: ["⌘+⇧+F", "ctrl+⇧+F"],
            },
        },
        {
            name: "Next Page",
            subtitle: "Go to next page",
            icon: ArrowRight,
            keywords: "next",
            action: {
                handler: () => {
                    if (!isDrawerOpen) {
                        const pageCount = get(handler.context.pageCount);
                        const pageNumber = get(handler.context.pageNumber);
                        handler.context.pageNumber.update((n) => {
                            if (pageNumber < pageCount) {
                                return n + 1;
                            }
                            return n;
                        });
                    }
                },
                options: { scope: "requests", single: true },
                keys: ["⌘+]", "ctrl+]"],
            },
        },
        {
            name: "Previous Page",
            subtitle: "Go to the previous page",
            keywords: "previous",
            icon: ArrowLeft,
            action: {
                handler: () => {
                    if (!isDrawerOpen) {
                        const pageNumber = get(handler.context.pageNumber);
                        handler.context.pageNumber.update((n) => {
                            if (pageNumber > 1) {
                                return n - 1;
                            }
                            return n;
                        });
                    }
                },
                options: { scope: "requests", single: true },
                keys: ["⌘+[", "ctrl+["],
            },
        },
        {
            name: "Open Drawer",
            subtitle: "Open request by index",
            keywords: "open",
            icon: SquareArrowOutUpRight,
            action: {
                handler: () => {
                    if (isDrawerOpen) return;
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
                                    Object.values($rows).indexOf(selectedItem);
                                if (rowIndex >= 0) {
                                    openDrawer(selectedItem);
                                }
                            }
                        }
                    });
                },
                options: { scope: "requests", single: true },
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

    function normalizeColor(color) {
        if (color === undefined || color === null) return "";
        if (typeof color === "string") {
            if (color.startsWith("#")) return color;
            if (/^\d+$/.test(color)) {
                return `#${Number(color).toString(16).padStart(6, "0")}`;
            }
            return color;
        }
        if (typeof color === "number") {
            return `#${color.toString(16).padStart(6, "0")}`;
        }
        return "";
    }

    function getRowColor(row) {
        if (highlightAssignments.has(row.Request.ID)) {
            return highlightAssignments.get(row.Request.ID);
        }
        return normalizeColor(row.Metadata?.Highlight);
    }

    function getSelectionColor(selection, filter) {
        if (!selection) return "";
        return normalizeColor(selection.color || filter?.color || "#f59e0b");
    }

    const TOKEN_MATCHER = /[A-Za-z0-9_.-]/;

    function getSuggestionContext() {
        if (!httpqlInputEl) return null;
        const value = get(httpqlQuery);
        const cursor = httpqlInputEl.selectionStart;
        const selectionEnd = httpqlInputEl.selectionEnd;
        const anchor = Math.min(cursor, selectionEnd);
        let start = anchor;
        while (start > 0 && TOKEN_MATCHER.test(value[start - 1])) {
            start -= 1;
        }
        let end = anchor;
        while (end < value.length && TOKEN_MATCHER.test(value[end])) {
            end += 1;
        }
        const baseText = value.slice(start, anchor);
        const tokenRange = { start, end: anchor };
        const uptoCursor = value.slice(0, anchor);
        const qualifiedMatch = uptoCursor.match(/[A-Za-z0-9_.-]+$/);
        if (qualifiedMatch) {
            const qualified = qualifiedMatch[0];
            const replaceStart = anchor - qualified.length;
            return {
                text: baseText,
                range: tokenRange,
                qualified,
                replaceRange: { start: replaceStart, end: anchor },
            };
        }
        return {
            text: baseText,
            range: tokenRange,
            qualified: baseText,
            replaceRange: tokenRange,
        };
    }

    function clearSuggestions() {
        httpqlSuggestions = [];
        suggestionVisible = false;
        suggestionPrefix = "";
        activeSuggestionIndex = 0;
        if (!suppressSuggestionUpdate) {
            lastSuggestionRange = null;
        }
    }

    function refreshHttpqlSuggestions() {
        if (!httpqlInputEl) return;
        const context = getSuggestionContext();
        if (!context || context.qualified.trim().length < 1) {
            clearSuggestions();
            return;
        }
        const prefix = context.qualified.toLowerCase();
        const matches = HTTPQL_COMPLETIONS.filter((entry) =>
            entry.toLowerCase().startsWith(prefix),
        );
        if (!matches.length) {
            clearSuggestions();
            return;
        }
        suggestionPrefix = context.qualified;
        httpqlSuggestions = matches;
        suggestionVisible = true;
        if (!lastSuggestionRange) {
            lastSuggestionRange = { ...context.replaceRange };
        }
        activeSuggestionIndex = Math.min(
            activeSuggestionIndex,
            httpqlSuggestions.length - 1,
        );
    }

    function replaceRange(range, text) {
        if (!httpqlInputEl || !range || typeof text !== "string") return;
        const value = get(httpqlQuery);
        const nextValue =
            value.slice(0, range.start) + text + value.slice(range.end);
        const cursor = range.start + text.length;
        suppressSuggestionUpdate = true;
        httpqlQuery.set(nextValue);
        tick().then(() => {
            suppressSuggestionUpdate = false;
            if (!httpqlInputEl) return;
            httpqlInputEl.focus();
            httpqlInputEl.setSelectionRange(cursor, cursor);
            lastSuggestionRange = { start: range.start, end: cursor };
            refreshHttpqlSuggestions();
        });
    }

    function applySuggestionAt(index) {
        if (!httpqlSuggestions.length) return;
        const boundedIndex =
            (index + httpqlSuggestions.length) % httpqlSuggestions.length;
        activeSuggestionIndex = boundedIndex;
        const suggestion = httpqlSuggestions[boundedIndex];
        const context = getSuggestionContext();
        if (context) {
            lastSuggestionRange = { ...context.replaceRange };
        }
        const contextRange =
            lastSuggestionRange &&
            lastSuggestionRange.end > lastSuggestionRange.start
                ? lastSuggestionRange
                : context?.replaceRange;
        if (!contextRange) return;
        replaceRange(contextRange, suggestion);
    }

    function handleHttpqlInput() {
        if (suppressSuggestionUpdate) {
            return;
        }
        lastSuggestionRange = null;
        refreshHttpqlSuggestions();
    }

    function handleHttpqlKeydown(event) {
        if (!httpqlSuggestions.length) {
            if (event.key === "Tab") {
                suggestionVisible = false;
            }
            return;
        }
        const cycling =
            lastSuggestionRange &&
            httpqlInputEl.selectionStart === lastSuggestionRange.end &&
            httpqlInputEl.selectionEnd === lastSuggestionRange.end;
        switch (event.key) {
            case "Tab":
                event.preventDefault();
                if (cycling) {
                    const delta = event.shiftKey ? -1 : 1;
                    activeSuggestionIndex =
                        (activeSuggestionIndex +
                            delta +
                            httpqlSuggestions.length) %
                        httpqlSuggestions.length;
                    replaceRange(
                        lastSuggestionRange,
                        httpqlSuggestions[activeSuggestionIndex],
                    );
                } else {
                    activeSuggestionIndex = event.shiftKey
                        ? httpqlSuggestions.length - 1
                        : 0;
                    const context = getSuggestionContext();
                    if (context) {
                        lastSuggestionRange = { ...context.replaceRange };
                    }
                    applySuggestionAt(activeSuggestionIndex);
                }
                break;
            case "ArrowDown":
                event.preventDefault();
                activeSuggestionIndex =
                    (activeSuggestionIndex + 1) % httpqlSuggestions.length;
                break;
            case "ArrowUp":
                event.preventDefault();
                activeSuggestionIndex =
                    (activeSuggestionIndex - 1 + httpqlSuggestions.length) %
                    httpqlSuggestions.length;
                break;
            case "Enter":
                if (suggestionVisible) {
                    event.preventDefault();
                    applySuggestionAt(activeSuggestionIndex);
                }
                break;
            case "Escape":
                clearSuggestions();
                break;
        }
    }

    function handleHttpqlClick() {
        refreshHttpqlSuggestions();
    }

    function handleSuggestionClick(index) {
        applySuggestionAt(index);
    }

    function handleHttpqlBlur() {
        setTimeout(() => {
            suggestionVisible = false;
        }, 120);
    }

    function applyAdvancedFilters(
        rowsToFilter,
        selections,
        compiledMap,
        filters,
    ) {
        if (!selections.length) {
            return { rows: rowsToFilter, highlight: new Map() };
        }
        let working = [...rowsToFilter];
        const highlight = new Map();
        selections.forEach((selection) => {
            const compiled = compiledMap.get(selection.id);
            if (!compiled || compiled.error) return;
            const filter = filters.get(selection.id);
            if (selection.mode === "include") {
                working = working.filter((row) => compiled.test(row));
            } else if (selection.mode === "exclude") {
                working = working.filter((row) => !compiled.test(row));
            } else if (selection.mode === "highlight") {
                working.forEach((row) => {
                    if (compiled.test(row)) {
                        const color =
                            selection.color || filter?.color || "#fde047";
                        highlight.set(row.Request.ID, normalizeColor(color));
                    }
                });
            }
        });
        return { rows: working, highlight };
    }

    function addFilter(filterId) {
        const filter = filterMap.get(filterId);
        if (!filter) return;
        requestFilterSelections.update((current) => {
            if (current.some((selection) => selection.id === filterId)) {
                return current;
            }
            return [
                ...current,
                {
                    id: filterId,
                    mode: filter.defaultAction || "highlight",
                    color: filter.color,
                },
            ];
        });
    }

    function removeFilter(filterId) {
        requestFilterSelections.update((current) =>
            current.filter((selection) => selection.id !== filterId),
        );
    }

    function toggleFilter(filterId) {
        if (activeFilterIds.has(filterId)) {
            removeFilter(filterId);
        } else {
            addFilter(filterId);
        }
    }

    function updateSelectionMode(filterId, mode) {
        requestFilterSelections.update((current) =>
            current.map((selection) =>
                selection.id === filterId ? { ...selection, mode } : selection,
            ),
        );
    }

    function updateSelectionColor(filterId, color) {
        requestFilterSelections.update((current) =>
            current.map((selection) =>
                selection.id === filterId ? { ...selection, color } : selection,
            ),
        );
    }

    function openDrawer(row) {
        const requestIndex = Object.values($proxyItems).indexOf(row) + 1;
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
                position: "bottom",
            };
            selectedId = row;
            drawerStore.open(drawerSettings);
        });
    }

    function reselect() {
        if (selectedId) {
            selectedId = $proxyItems[selectedId?.Request?.ID];
        }
    }

    $: if ($proxyItems) {
        reselect();
    }

    $: filterMap = new Map(
        $requestFilters.map((filter) => [filter.id, filter]),
    );
    $: compiledFilters = new Map(
        $requestFilters.map((filter) => [
            filter.id,
            compileHttpql(filter.expression),
        ]),
    );
    $: filterErrorMap = new Map(
        Array.from(compiledFilters.entries())
            .filter(([, compiled]) => compiled.error)
            .map(([id, compiled]) => [id, compiled.error.message]),
    );
    $: selectionMap = new Map(
        $requestFilterSelections.map((selection) => [selection.id, selection]),
    );
    $: selectionSummary = $requestFilterSelections.map((selection) => ({
        ...selection,
        filter: filterMap.get(selection.id),
        error: filterErrorMap.get(selection.id),
    }));
    $: activeFilterIds = new Set(
        $requestFilterSelections.map((selection) => selection.id),
    );
    $: filterCardSummaries = Array.from(filterMap.values()).map((filter) => ({
        filter,
        selection: selectionMap.get(filter.id),
    }));
    $: httpqlCompilation = compileHttpql($httpqlQuery);
    $: httpqlError = httpqlCompilation.error
        ? httpqlCompilation.error.message
        : "";
    $: {
        const validIds = new Set(filterMap.keys());
        if (
            $requestFilterSelections.some(
                (selection) => !validIds.has(selection.id),
            )
        ) {
            requestFilterSelections.update((current) =>
                current.filter((selection) => validIds.has(selection.id)),
            );
        }
    }
    $: {
        const baseRows = Object.values($proxyItems).reverse();
        const shouldApplyHttpql =
            $httpqlQuery.trim().length > 0 && !httpqlCompilation.error;
        const httpqlRows = shouldApplyHttpql
            ? baseRows.filter((row) => httpqlCompilation.test(row))
            : baseRows;
        const { rows: advancedRows, highlight } = applyAdvancedFilters(
            httpqlRows,
            $requestFilterSelections,
            compiledFilters,
            filterMap,
        );
        highlightAssignments = highlight;
        handler.setRows(advancedRows);
    }

    onMount(() => {
        handler.search($searchInput);
        const unsubscribe = drawerStore.subscribe((settings) => {
            isDrawerOpen = settings.open ? settings.open : false;
            menu.menuOptions = isDrawerOpen ? drawerMenu : requestsMenu;
        });
        return () => {
            isDrawerOpen = false;
            unsubscribe();
        };
    });
</script>

<MarasiKeys bind:this={menu} scope="requests" menuOptions={requestsMenu} />
<Accordion rounded="none">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Requests Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <footer class="flex flex-wrap gap-4 justify-between items-center">
                <Search bind:value={$searchInput} id="searchBox" {handler} />
                <RowsPerPage {handler} />
                <RowCount {handler} />
                <Pagination {handler} />
            </footer>
            <section class="httpql-panel">
                <label for="httpqlInput">HTTPQL Search</label>
                <div class="httpql-input-wrapper">
                    <textarea
                        id="httpqlInput"
                        rows="3"
                        bind:this={httpqlInputEl}
                        bind:value={$httpqlQuery}
                        placeholder="method = GET AND response.status >= 400"
                        on:input={handleHttpqlInput}
                        on:keydown={handleHttpqlKeydown}
                        on:click={handleHttpqlClick}
                        on:blur={handleHttpqlBlur}
                    ></textarea>
                    {#if suggestionVisible && httpqlSuggestions.length}
                        <div class="httpql-suggestions">
                            <p class="hint-label">
                                Suggestions for “{suggestionPrefix}” — Tab to
                                insert
                            </p>
                            <ul>
                                {#each httpqlSuggestions as suggestion, index}
                                    <li
                                        class={index === activeSuggestionIndex
                                            ? "active"
                                            : ""}
                                    >
                                        <button
                                            type="button"
                                            on:mousedown|preventDefault={() =>
                                                handleSuggestionClick(index)}
                                        >
                                            <span class="suggestion-text">
                                                {#if suggestionPrefix.length > 0}
                                                    <span
                                                        class="suggestion-match"
                                                    >
                                                        {suggestion.slice(
                                                            0,
                                                            suggestionPrefix.length,
                                                        )}
                                                    </span>
                                                    <span>
                                                        {suggestion.slice(
                                                            suggestionPrefix.length,
                                                        )}
                                                    </span>
                                                {:else}
                                                    <span>{suggestion}</span>
                                                {/if}
                                            </span>
                                        </button>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}
                </div>
                {#if httpqlError}
                    <p class="error-label">{httpqlError}</p>
                {:else if $httpqlQuery.trim().length}
                    <p class="hint">
                        Matching requests using HTTPQL. Available helpers:
                        <code>hasBase64Url()</code>, <code>reflects()</code>
                    </p>
                {:else}
                    <p class="hint">
                        Try queries such as
                        <code
                            >request.method = POST AND response.status >= 500</code
                        >
                    </p>
                {/if}
            </section>
            <section class="filter-panel">
                <div class="filter-panel__header">
                    <h3>Reusable Filters</h3>
                    <button
                        type="button"
                        class="link"
                        on:click={() => goto("/filters")}
                    >
                        Manage filters
                    </button>
                </div>
                <div
                    class="filter-card-row"
                    role="region"
                    aria-label="Reusable filters"
                    style="display:flex; gap:0.75rem; overflow-x:auto; padding-bottom:0.5rem; -webkit-overflow-scrolling:touch;"
                    tabindex="0"
                >
                    {#each filterCardSummaries as card (card.filter.id)}
                        <article
                            class={`filter-card ${card.selection ? "filter-card--active" : ""}`}
                            style={`flex: 0 0 280px; min-width: 240px; ${card.selection ? `border-color: ${getSelectionColor(card.selection, card.filter)}; box-shadow: 0 0 0 1px ${getSelectionColor(card.selection, card.filter)}55;` : ""}`}
                        >
                            <header>
                                <div class="filter-card__title">
                                    <h4>{card.filter.name}</h4>
                                    {#if card.selection}
                                        <span
                                            class="color-pill"
                                            style={`background: ${getSelectionColor(card.selection, card.filter)}`}
                                        ></span>
                                    {/if}
                                </div>
                                <button
                                    type="button"
                                    class="chip"
                                    on:click={() =>
                                        toggleFilter(card.filter.id)}
                                >
                                    {card.selection ? "Remove" : "Apply"}
                                </button>
                            </header>
                            {#if card.filter.description}
                                <p>{card.filter.description}</p>
                            {/if}
                            <code>{card.filter.expression}</code>
                            {#if filterErrorMap.get(card.filter.id)}
                                <p class="error-label">
                                    {filterErrorMap.get(card.filter.id)}
                                </p>
                            {/if}
                        </article>
                    {/each}
                </div>
                <div class="active-filter-list">
                    <h4>Active Filter Behaviour</h4>
                    {#if selectionSummary.length === 0}
                        <p class="hint">No filters selected.</p>
                    {:else}
                        {#each selectionSummary as selection (selection.id)}
                            <div class="selected-filter">
                                <div class="selected-filter__info">
                                    <div class="selected-filter__title">
                                        <strong
                                            >{selection.filter?.name ??
                                                "Missing filter"}</strong
                                        >
                                        {#if selection.mode === "highlight"}
                                            <span
                                                class="color-pill"
                                                style={`background: ${getSelectionColor(selection, selection.filter)}`}
                                            ></span>
                                        {/if}
                                    </div>
                                    <small
                                        >{selection.filter?.description}</small
                                    >
                                </div>
                                <label>
                                    Mode
                                    <select
                                        value={selection.mode}
                                        on:change={(event) =>
                                            updateSelectionMode(
                                                selection.id,
                                                event.currentTarget.value,
                                            )}
                                    >
                                        <option value="exclude"
                                            >Filter out matches</option
                                        >
                                        <option value="include"
                                            >Only show matches</option
                                        >
                                        <option value="highlight"
                                            >Highlight matches</option
                                        >
                                    </select>
                                </label>
                                {#if selection.mode === "highlight"}
                                    <label>
                                        Color
                                        <input
                                            type="color"
                                            value={normalizeColor(
                                                selection.color ||
                                                    selection.filter?.color ||
                                                    "#fde047",
                                            )}
                                            on:input={(event) =>
                                                updateSelectionColor(
                                                    selection.id,
                                                    event.currentTarget.value,
                                                )}
                                        />
                                    </label>
                                {/if}
                                <button
                                    type="button"
                                    class="chip chip--danger"
                                    on:click={() => removeFilter(selection.id)}
                                >
                                    Remove
                                </button>
                                {#if selection.error}
                                    <p class="error-label">{selection.error}</p>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                </div>
            </section>
        </svelte:fragment>
    </AccordionItem>
</Accordion>

<div class="no-select table-container">
    <table class="table table-auto w-full">
        <thead>
            <tr>
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
                    style="background-color: {getRowColor(row)}"
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
                                    {#if row.Metadata.has_note && row.Metadata.has_note === 1}<Edit2Icon
                                            size="10"
                                        />{/if}
                                    {#if row.Metadata.override_host}<Replace
                                            size="10"
                                        />{/if}
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
                            "Request " + requestIndex + " sent to Launchpad",
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
        }}
    >
        Send to Launchpad
    </Item>
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
    thead th {
        text-align: center;
        padding: 4px;
        line-height: normal;
        border-bottom: 1px solid #cf595b;
        white-space: nowrap;
    }

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

    .id-cell,
    .method-cell,
    .ctype-cell,
    .clength-cell,
    .status-cell {
        width: 1%;
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
        max-width: 50em;
    }

    .id-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25em;
    }

    .icon-row {
        display: flex;
        gap: 0.25em;
        margin: 0;
    }

    .httpql-panel {
        margin-top: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }
    .httpql-panel .httpql-input-wrapper {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .httpql-panel textarea {
        width: 100%;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.5rem;
        padding: 0.5rem;
        font-family: var(--font-mono, monospace);
    }

    .httpql-suggestions {
        position: absolute;
        top: 100%;
        left: 0;
        width: 100%;
        background: rgba(12, 15, 21, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.5rem;
        margin-top: 0.25rem;
        padding: 0.35rem 0.35rem 0.5rem;
        z-index: 10;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    }

    .httpql-suggestions .hint-label {
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.5);
        margin: 0 0 0.25rem 0;
        padding-left: 0.25rem;
    }

    .httpql-suggestions ul {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 160px;
        overflow-y: auto;
    }

    .httpql-suggestions li button {
        width: 100%;
        text-align: left;
        border: 0;
        background: transparent;
        color: inherit;
        padding: 0.3rem 0.5rem;
        border-radius: 0.4rem;
        cursor: pointer;
        font-family: var(--font-mono, monospace);
        font-size: 0.85rem;
    }

    .suggestion-text {
        display: inline-flex;
        gap: 0.05rem;
    }

    .suggestion-match {
        color: #facc15;
    }

    .httpql-suggestions li.active button {
        background: rgba(96, 165, 250, 0.15);
        color: #dbeafe;
    }

    .filter-panel {
        margin-top: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .filter-panel__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .filter-card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 0.75rem;
    }

    .filter-card {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 0.75rem;
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        background: rgba(255, 255, 255, 0.02);
    }

    .filter-card--active {
        border-color: #f59e0b;
        box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3);
    }

    .filter-card header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }
    .filter-card__title {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .filter-card code {
        font-size: 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        padding: 0.2rem 0.4rem;
        border-radius: 0.35rem;
    }

    .chip {
        padding: 0.2rem 0.6rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 0;
        cursor: pointer;
    }

    .chip--danger {
        background: rgba(239, 68, 68, 0.15);
        color: #f87171;
    }

    .link {
        border: 0;
        background: none;
        color: #60a5fa;
        cursor: pointer;
    }

    .active-filter-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .selected-filter {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        align-items: center;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 0.75rem;
        background: rgba(255, 255, 255, 0.015);
    }

    .selected-filter__info {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .selected-filter__title {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .selected-filter label {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        font-size: 0.8rem;
    }
    .color-pill {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.4);
    }

    .selected-filter select,
    .selected-filter input[type="color"] {
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 0.25rem;
        background: rgba(0, 0, 0, 0.2);
    }

    .hint {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
    }

    .error-label {
        font-size: 0.8rem;
        color: #f87171;
    }
</style>
