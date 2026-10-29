<script>
    // Launchpad: a resizable dock with the launchpad file tree, and the
    // workspace with the Launchpad draft and response side by side. State
    // and API calls live in launchpadStore; this page wires confirmations,
    // toasts and the existing launchpad.* catalog actions.
    import { getModalStore, getToastStore, modeCurrent } from "@skeletonlabs/skeleton";
    import {
        ArrowDownIcon,
        ArrowDownToLineIcon,
        ArrowLeftIcon,
        ArrowLeftRightIcon,
        ArrowRightIcon,
        ArrowUpIcon,
        ArrowUpToLineIcon,
        BookCheckIcon,
        BracesIcon,
        CircleStopIcon,
        Columns2Icon,
        FolderTreeIcon,
        GitCompareIcon,
        GlobeIcon,
        ListChecksIcon,
        LockIcon,
        PanelLeftIcon,
        PenIcon,
        PenLineIcon,
        PlayIcon,
        PlusIcon,
        SearchIcon,
        ShieldAlertIcon,
        TrashIcon,
    } from "lucide-svelte";
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { afterNavigate } from "$app/navigation";
    import { page } from "$app/stores";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import { useMenuActions } from "../../lib/keybindings/app.js";
    import LaunchpadDock from "../../lib/launchpad/LaunchpadDock.svelte";
    import LaunchpadTree from "../../lib/launchpad/LaunchpadTree.svelte";
    import LaunchpadWorkspace from "../../lib/launchpad/LaunchpadWorkspace.svelte";
    import { compareClick, compareEscape } from "../../lib/launchpad/compare.js";
    import { entryMenuFor, launchpadMenuFor } from "../../lib/launchpad/entryMenu.js";
    import { lastEntry } from "../../lib/launchpad/jumpTarget.js";
    import RowMenu from "../../lib/ledger/RowMenu.svelte";
    import { menuAction } from "../../lib/ledger/rowMenu.js";
    import { GetMetadata, GetNote } from "../../lib/wailsjs/go/main/App";
    import { listener } from "../../stores";
    import { findingStore } from "../../stores/findingStore";
    import { testCaseStore } from "../../stores/testCaseStore";
    import { newRecord } from "../../lib/logbook/recordEditor.js";
    import { linkedText, requestCount, unchangedText } from "../../lib/ledger/counts.js";
    import {
        isDraftDirty,
        launchpadStore,
        pendingEntryIds,
        pendingLaunchOf,
        selectedEntryIds,
    } from "../../stores/launchpadStore";
    import {
        DELETE_LAUNCHPAD_PENDING_HINT,
        pendingLaunchIDs,
        toastLaunchingRefusal,
        warnLaunching,
    } from "../../lib/launchPending.js";
    import { UNTITLED_LAUNCHPAD } from "../../lib/launchpad/format.js";
    import { latestRequest } from "../../lib/latestRequest.js";
    import { handoffBackground, toastError } from "../../lib/toasts.js";
    import { BROWSER_VIEW_COPIED, browserViewRefusal, browserViewURL } from "../../lib/browserView.js";

    const modalStore = getModalStore();
    const toastStore = getToastStore();

    let dock;
    let tree;
    let workspace;
    let searchInput;
    let groupByStatus;

    let mounted = false;
    onMount(async () => {
        const id = $page.url.searchParams.get("id");
        if (id) await openJump(id);
        else await launchpadStore.populate();
        mounted = true;
    });
    // The Ledger's toast can also jump while this page is already open.
    afterNavigate(({ to }) => {
        const id = to?.url.searchParams.get("id");
        if (mounted && id) openJump(id);
    });

    // Jump to Launchpad (/launchpad?id=<id>, from the Ledger): open that
    // launchpad on its newest entry, open its rows even after Collapse all,
    // and scroll it into view. An unknown id keeps the current launchpad.
    async function openJump(id) {
        const { found, entryId, needsConfirm } = await launchpadStore.jumpTo(id);
        if (!found) {
            toastStore.trigger({
                message: "That launchpad no longer exists.",
                background: "variant-filled-warning",
            });
            return;
        }
        if (!entryId) return;
        const show = () => tree?.showEntry(id, entryId);
        if (!needsConfirm) return show();
        // The draft stays until confirmed; the launchpad is open meanwhile.
        confirm(
            "Discard the draft?",
            "This launchpad's draft has unsaved edits. Loading its newest entry replaces them.",
            () => launchpadStore.selectEntry(id, entryId, { force: true }).then(show),
        );
    }

    function confirm(title, body, onConfirm) {
        modalStore.trigger({
            type: "confirm",
            title,
            body,
            response: (ok) => ok && onConfirm(),
        });
    }

    async function pickEntry(launchpadId, entryId) {
        // While comparing, a click on the compared launchpad fills a side.
        const side = compareClick(get(launchpadStore), launchpadId, entryId);
        if (side === "ignore") return;
        if (side) return launchpadStore.setCompareSide(side, entryId);
        const { needsConfirm } = await launchpadStore.selectEntry(launchpadId, entryId);
        if (!needsConfirm) return;
        confirm(
            "Discard the draft?",
            "This launchpad's draft has unsaved edits. Loading another entry replaces them.",
            () => launchpadStore.selectEntry(launchpadId, entryId, { force: true }),
        );
    }

    // A Move from the tree or the entry menu. The draft follows its entry,
    // so a move that would replace the target's dirty draft asks first;
    // Cancel cancels the move. Marasi's refusals (the view was stale) and
    // failures become toasts; the store has reloaded both launchpads.
    async function moveEntries(move, options = {}) {
        try {
            const result = await launchpadStore.moveEntries(move, options);
            if (result.needsConfirm) return confirmMove(move);
            if (result.refused) {
                toastStore.trigger({ message: result.refused, background: "variant-filled-warning" });
            }
            return result;
        } catch (err) {
            console.error("Launchpad move error:", err);
            toastError(toastStore, "Failed to move the entries", err);
            return { moved: null, refused: null };
        }
    }

    // Resolves once the researcher answers, so the caller can show the moved
    // entries; a cancelled move resolves as nothing moved.
    function confirmMove(move) {
        return new Promise((resolve) => {
            modalStore.trigger({
                type: "confirm",
                title: "Discard the draft?",
                body: "The target launchpad's draft has unsaved edits. The draft moving with its entry replaces them.",
                response: (ok) =>
                    resolve(ok ? moveEntries(move, { force: true }) : { moved: null, refused: null }),
            });
        });
    }

    // The entry context menu (RowMenu with entryMenu.js items) for the
    // Entry selection. Its Order items are also the tree's ⌥-arrow actions.
    let entryMenu = { open: false, x: 0, y: 0 };

    function entryMenuInput(state) {
        const { launchpadId } = state.entrySelection;
        const entries = state.entriesByLaunchpad[launchpadId] || [];
        const ids = selectedEntryIds(state);
        return {
            launchpadId,
            entries,
            ids,
            launchpads: state.launchpads,
            entriesByLaunchpad: state.entriesByLaunchpad,
            pendingIds: pendingEntryIds(state, launchpadId, ids),
            findings: $findingStore,
            testCases: $testCaseStore,
            grouped: groupByStatus,
            searching: state.search.trim() !== "",
        };
    }

    $: entryMenuData = entryMenu.open ? entryMenuInput($launchpadStore) : null;
    $: entryMenuEntries = entryMenuData ? entryMenuData.entries.filter((e) => entryMenuData.ids.includes(e.ID)) : [];
    $: entryMenuName = $launchpadStore.launchpads.find((l) => l.ID === entryMenuData?.launchpadId)?.Name;

    function openEntryMenu(x, y) {
        if (!selectedEntryIds(get(launchpadStore)).length) return;
        launchpadMenuRequests.start();
        entryMenu = { open: true, x, y };
    }

    // The launchpad context menu (RowMenu with launchpadMenuFor items) for a
    // launchpad row. It acts on that launchpad, which need not be the open
    // one, and leaves the open launchpad, its draft and the Entry selection.
    let rowLaunchpadMenu = { open: false, x: 0, y: 0, launchpadId: null };
    // Only the latest right-click opens its menu: a collapsed launchpad's
    // entries can finish loading after a later right-click has opened one.
    const launchpadMenuRequests = latestRequest();

    function launchpadMenuInput(state, launchpadId) {
        const launchpad = state.launchpads.find((l) => l.ID === launchpadId);
        if (!launchpad) return null;
        return {
            launchpad,
            entries: state.entriesByLaunchpad[launchpadId] || [],
            findings: $findingStore,
            testCases: $testCaseStore,
            pending: Boolean(pendingLaunchOf(state, launchpadId)),
        };
    }

    $: launchpadMenuData = rowLaunchpadMenu.open
        ? launchpadMenuInput($launchpadStore, rowLaunchpadMenu.launchpadId)
        : null;

    // A collapsed launchpad's entries load first, so the link states are
    // never unknown.
    async function openLaunchpadMenu(launchpadId, x, y) {
        const latest = launchpadMenuRequests.start();
        entryMenu = { ...entryMenu, open: false };
        if (get(launchpadStore).entriesByLaunchpad[launchpadId] === undefined) {
            try {
                await launchpadStore.loadEntries(launchpadId);
            } catch (err) {
                console.error("Launchpad entries error:", err);
                if (latest()) toastError(toastStore, "Failed to load the entries", err);
                return;
            }
            if (!latest() || get(launchpadStore).entriesByLaunchpad[launchpadId] === undefined) return;
        }
        rowLaunchpadMenu = { open: true, x, y, launchpadId };
    }

    // Runs a launchpad menu item's action on the launchpad it was opened for.
    // The Finding and Test case ones act on all of its entries.
    // Delete goes through the tab's deleteLaunchpad.
    function runLaunchpadAction(action) {
        const { launchpadId } = rowLaunchpadMenu;
        if (action.type === "rename") return renameLaunchpad(launchpadId);
        if (action.type === "delete") return deleteLaunchpad(launchpadId);
        const ids = (get(launchpadStore).entriesByLaunchpad[launchpadId] || []).map((entry) => entry.ID);
        runRecordAction(action, ids);
    }

    // Asks for a new name only; the workspace header edits the description.
    function renameLaunchpad(launchpadId) {
        const launchpad = get(launchpadStore).launchpads.find((l) => l.ID === launchpadId);
        if (!launchpad) return;
        modalStore.trigger({
            type: "prompt",
            title: "Rename launchpad",
            value: launchpad.Name,
            valueAttr: { type: "text", required: true },
            buttonTextSubmit: "Rename",
            response: async (name) => {
                if (typeof name !== "string") return;
                try {
                    await launchpadStore.renameLaunchpad(launchpadId, name);
                } catch (err) {
                    console.error("Launchpad rename error:", err);
                    toastError(toastStore, "Failed to rename the launchpad", err);
                }
            },
        });
    }

    // Runs a menu item's action on the Entry selection. Any type other than
    // remove, browser-view and the Finding and Test case ones is taken as a
    // move or reorder (entryMenuFor), so a new type needs its own branch
    // above that.
    async function runEntryAction(action) {
        const state = get(launchpadStore);
        const sourceId = state.entrySelection.launchpadId;
        const ids = selectedEntryIds(state);
        if (!sourceId || !ids.length) return;
        if (action.type === "remove") return removeEntries(sourceId, ids);
        if (action.type === "browser-view") return copyBrowserView(action.id);
        if (runRecordAction(action, ids)) return;
        const targetId = action.type === "move" ? action.targetId : sourceId;
        const before = action.type === "move" ? null : action.before;
        const { moved } = await moveEntries({ sourceId, targetId, ids, before });
        if (moved?.length) await tree?.showEntry(targetId, moved[0]);
    }

    // Removing the entry a dirty draft came from would replace the draft,
    // so it asks first; Cancel removes nothing.
    async function removeEntries(launchpadId, ids, options = {}) {
        const name = get(launchpadStore).launchpads.find((l) => l.ID === launchpadId)?.Name || UNTITLED_LAUNCHPAD;
        try {
            const { removed: count, needsConfirm } = await launchpadStore.removeEntries(launchpadId, ids, options);
            if (needsConfirm) {
                confirm(
                    "Discard the draft?",
                    "This launchpad's draft has unsaved edits. Removing the entry it came from replaces them.",
                    () => removeEntries(launchpadId, ids, { force: true }),
                );
                return;
            }
            toastStore.trigger({
                message: `Removed ${count === 1 ? "1 entry" : `${count} entries`} from "${name}"`,
                background: "variant-filled-success",
            });
        } catch (err) {
            if (toastLaunchingRefusal(toastStore, err, "removed", "entry")) return;
            console.error("Launchpad remove error:", err);
            toastError(toastStore, "Failed to remove the entries", err);
        }
    }

    // The link and unlink items' action types: which way, the record's noun
    // for the toasts and its kind for Marasi.
    const LINK_ACTIONS = {
        "link-finding": { link: true, noun: "finding", kind: "finding" },
        "unlink-finding": { link: false, noun: "finding", kind: "finding" },
        "link-test-case": { link: true, noun: "test case", kind: "test_case" },
        "unlink-test-case": { link: false, noun: "test case", kind: "test_case" },
    };

    // The Finding and Test case items over entries `ids`, whose pairs they
    // act on. False for any other action.
    function runRecordAction(action, ids) {
        if (action.type === "new-finding") newRecord(modalStore, "finding", { requestIds: ids });
        else if (action.type === "new-test-case") newRecord(modalStore, "testCase", { requestIds: ids });
        else if (LINK_ACTIONS[action.type]) changeLinks(ids, LINK_ACTIONS[action.type], action);
        else return false;
        return true;
    }

    // Links or unlinks the entries' pairs and a finding or test case, with
    // the Ledger's toasts; the store's mapping rereads that kind's list.
    // `how` is a LINK_ACTIONS value.
    async function changeLinks(ids, how, { id, title }) {
        const { link, noun, kind } = how;
        let count;
        try {
            count = link
                ? await launchpadStore.linkEntriesToRecord(ids, kind, id)
                : await launchpadStore.unlinkEntriesFromRecord(ids, kind, id);
        } catch (err) {
            console.error("Launchpad link error:", err);
            toastStore.trigger({
                message: `Failed to ${link ? "link" : "unlink"} ${requestCount(ids.length)}: ${String(err)}`,
                background: "variant-filled-error",
                timeout: 10000,
                action: { label: "Retry", response: () => changeLinks(ids, how, { id, title }) },
            });
            return;
        }
        const background = handoffBackground($modeCurrent);
        const change = { type: link ? "link" : "unlink", noun, name: title };
        const message = count ? linkedText(change, count) : unchangedText(change, ids.length, "request");
        toastStore.trigger({ message, background });
    }

    // ⌥↑ ⌥↓ ⌥⇧↑ ⌥⇧↓, ⌘⇧F and ⌘⇧B in the tree: the menu's Order or New
    // item, run as choosing it would; when the menu greys it, its reason
    // instead.
    function runEntryShortcut(actionId) {
        entryMenu = { ...entryMenu, open: false };
        const input = entryMenuInput(get(launchpadStore));
        if (!input.ids.length) return;
        const item = menuAction(entryMenuFor(input), actionId);
        if (!item) return;
        if (item.disabled) {
            toastStore.trigger({ message: item.hint, background: "variant-filled-warning", timeout: 2000 });
            return;
        }
        runEntryAction(item.action);
    }

    // ⌘⇧↓ selects the open launchpad's last entry through the usual
    // draft guard. While that launchpad is compared, it only scrolls, so A
    // and B stay as picked.
    async function jumpToEnd() {
        const state = get(launchpadStore);
        const last = lastEntry(state);
        if (!last) return;
        if (state.compare?.launchpadId !== last.launchpadId) await pickEntry(last.launchpadId, last.entryId);
        await tree?.showEntry(last.launchpadId, last.entryId);
    }

    // Esc cancels a chip re-pick, then closes compare. Editors, inputs and
    // open modals keep their own Esc (vim mode uses it).
    function onKeydown(event) {
        if (event.key !== "Escape" || event.defaultPrevented || $modalStore.length) return;
        if (event.target?.closest?.("input, textarea, select, .cm-editor")) return;
        const action = compareEscape(get(launchpadStore));
        if (!action) return;
        event.preventDefault();
        if (action === "stop-picking") launchpadStore.pickCompareSide(null);
        else launchpadStore.closeCompare();
    }

    // Deletes launchpad `id` after confirming, from the tab, ⌘K (both the
    // open one) or the launchpad menu (any). Deleting one that isn't open
    // leaves the open launchpad, its draft and the Entry selection.
    function deleteLaunchpad(id) {
        const state = get(launchpadStore);
        const launchpad = state.launchpads.find((l) => l.ID === id);
        if (!launchpad) return;
        // Marasi refuses while a launch from it is pending (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md).
        if (pendingLaunchOf(state, launchpad.ID)) return warnDeleteLaunching();
        confirm(
            `Delete ${launchpad.Name || UNTITLED_LAUNCHPAD}?`,
            isDraftDirty(state, launchpad.ID) ? "Its unsaved draft will be discarded." : undefined,
            () =>
                launchpadStore.deleteLaunchpad(launchpad.ID).catch((err) => {
                    if (pendingLaunchIDs(err)) return warnDeleteLaunching();
                    console.error("Deleting the launchpad failed:", err);
                    toastStore.trigger({
                        message: "Failed to delete the launchpad",
                        background: "variant-filled-error",
                    });
                }),
        );
    }

    const deleteOpenLaunchpad = () => deleteLaunchpad(get(launchpadStore).selectedLaunchpadId);

    const warnDeleteLaunching = () => warnLaunching(toastStore, DELETE_LAUNCHPAD_PENDING_HINT);

    async function launch() {
        const state = get(launchpadStore);
        const id = state.selectedLaunchpadId;
        // While a launch is pending, the Launch button is Cancel.
        if (!id || pendingLaunchOf(state, id)) return;
        if (!$listener.status) {
            toastStore.trigger({
                message: "Listener is offline.",
                background: "variant-filled-error",
            });
            return;
        }
        try {
            // The launched entry arrives through the layout's request event
            // and the store selects it; launch-finished ends it.
            await launchpadStore.launch(id);
            toastStore.trigger({
                message: "Request launched",
                background: "variant-filled-success",
            });
        } catch (err) {
            console.error("Launchpad error:", err);
            toastStore.trigger({
                message: "Failed to launch the request",
                background: "variant-filled-error",
            });
        }
    }

    // A launch that finished before the cancel reached it comes back in its
    // final state from the binding, so only real failures show a toast.
    async function cancelLaunch() {
        const id = get(launchpadStore).selectedLaunchpadId;
        if (!id) return;
        try {
            await launchpadStore.cancelLaunch(id);
        } catch (err) {
            console.error("Launchpad cancel error:", err);
            toastStore.trigger({
                message: "Failed to cancel the launch",
                background: "variant-filled-error",
            });
        }
    }

    function stepLaunchpad(direction) {
        const { launchpads, selectedLaunchpadId } = get(launchpadStore);
        const index = launchpads.findIndex((l) => l.ID === selectedLaunchpadId);
        const next = launchpads[index + direction];
        if (next) launchpadStore.selectLaunchpad(next.ID);
    }

    function stepEntry(direction) {
        const state = get(launchpadStore);
        const id = state.selectedLaunchpadId;
        const entries = state.entriesByLaunchpad[id] || [];
        // While comparing, stepping moves B (pickEntry routes the click).
        const from =
            state.compare?.launchpadId === id && state.compare.rightId
                ? state.compare.rightId
                : state.selectedEntryByLaunchpad[id];
        const index = entries.findIndex((e) => e.ID === from);
        const next = entries[index + direction];
        if (next) pickEntry(id, next.ID);
    }

    function selectedEntry() {
        const state = get(launchpadStore);
        const id = state.selectedLaunchpadId;
        const entries = state.entriesByLaunchpad[id] || [];
        const index = entries.findIndex((e) => e.ID === state.selectedEntryByLaunchpad[id]);
        return index < 0 ? null : { entry: entries[index], number: index + 1 };
    }

    function copyBrowserView(entryId) {
        navigator.clipboard
            .writeText(browserViewURL(entryId))
            .then(() => toastStore.trigger({ message: BROWSER_VIEW_COPIED, background: "variant-filled-success" }))
            .catch((err) => toastError(toastStore, "Failed to copy the browser view URL", err));
    }

    // The open entry's browser view URL; when it has none, the reason.
    function copyOpenBrowserView() {
        const selected = selectedEntry();
        if (!selected) return;
        const refused = browserViewRefusal(selected.entry);
        if (refused) {
            toastStore.trigger({ message: refused, background: "variant-filled-warning", timeout: 2000 });
            return;
        }
        copyBrowserView(selected.entry.ID);
    }

    function toggleEntryModal(component, actionId, fetch, title) {
        const selected = selectedEntry();
        if (!selected) return;
        fetch(selected.entry.ID).then((content) => {
            if (!$modalStore[0]) {
                modalStore.trigger({
                    type: "component",
                    component,
                    toggleAction: actionId,
                    title: `Entry ${selected.number} ${title}`,
                    content,
                    requestID: selected.entry.ID,
                });
            } else if ($modalStore[0].component === component) {
                modalStore.close();
            }
        });
    }

    // The sidebar opens first so the tree's search box and new-launchpad
    // field are on screen when they take focus.
    async function createLaunchpad() {
        await dock?.expand();
        tree?.startCreate();
    }

    // Swapping needs both sides picked.
    function swapCompare() {
        const { compare } = get(launchpadStore);
        if (compare?.leftId && compare.rightId) launchpadStore.swapCompare();
    }

    // ⌘A in the tree: the focused launchpad is the entry selection's, else
    // the open one.
    function selectAllEntries() {
        const { entrySelection, selectedLaunchpadId } = get(launchpadStore);
        const id = entrySelection.launchpadId ?? selectedLaunchpadId;
        if (id) launchpadStore.selectAllEntries(id);
    }

    // Catalog actions keep their pre-redesign IDs (docs/adr/2026-10-10-keybinding-profiles-override-factory-defaults.md):
    // toggle-settings renames, *-tab steps launchpads.
    const launchpadMenu = [
        { actionId: "launchpad.focus-search", icon: SearchIcon, handler: () => dock?.expand(true) },
        { actionId: "launchpad.create", icon: PlusIcon, handler: createLaunchpad },
        {
            actionId: "launchpad.toggle-settings",
            icon: PenLineIcon,
            handler: () => workspace?.toggleEdit(),
        },
        { actionId: "launchpad.toggle-sidebar", icon: PanelLeftIcon, handler: () => dock?.toggle() },
        {
            actionId: "launchpad.toggle-group-by-status",
            icon: FolderTreeIcon,
            handler: () => (groupByStatus = !groupByStatus),
        },
        { actionId: "launchpad.jump-to-latest", icon: ArrowDownToLineIcon, handler: jumpToEnd },
        { actionId: "launchpad.toggle-compare", icon: GitCompareIcon, handler: () => workspace?.toggleCompare() },
        {
            actionId: "launchpad.toggle-compare-view",
            icon: Columns2Icon,
            handler: () => workspace?.toggleCompareView(),
        },
        { actionId: "launchpad.swap-compare", icon: ArrowLeftRightIcon, handler: swapCompare },
        { actionId: "launchpad.tree.select-all-entries", icon: ListChecksIcon, handler: selectAllEntries },
        { actionId: "launchpad.tree.move-entries-up", icon: ArrowUpIcon, handler: () => runEntryShortcut("launchpad.tree.move-entries-up") },
        { actionId: "launchpad.tree.move-entries-down", icon: ArrowDownIcon, handler: () => runEntryShortcut("launchpad.tree.move-entries-down") },
        { actionId: "launchpad.tree.move-entries-top", icon: ArrowUpToLineIcon, handler: () => runEntryShortcut("launchpad.tree.move-entries-top") },
        { actionId: "launchpad.tree.move-entries-bottom", icon: ArrowDownToLineIcon, handler: () => runEntryShortcut("launchpad.tree.move-entries-bottom") },
        { actionId: "launchpad.tree.create-finding", icon: ShieldAlertIcon, handler: () => runEntryShortcut("launchpad.tree.create-finding") },
        { actionId: "launchpad.tree.create-test-case", icon: BookCheckIcon, handler: () => runEntryShortcut("launchpad.tree.create-test-case") },
        { actionId: "launchpad.next-tab", icon: ArrowRightIcon, handler: () => stepLaunchpad(1) },
        { actionId: "launchpad.previous-tab", icon: ArrowLeftIcon, handler: () => stepLaunchpad(-1) },
        { actionId: "launchpad.next-entry", icon: ArrowDownIcon, handler: () => stepEntry(1) },
        { actionId: "launchpad.previous-entry", icon: ArrowDownIcon, handler: () => stepEntry(-1) },
        { actionId: "launchpad.delete-tab", icon: TrashIcon, handler: deleteOpenLaunchpad },
        {
            actionId: "launchpad.edit-request",
            icon: PenIcon,
            handler: () => document.querySelector(".lp-editor .cm-content")?.focus(),
        },
        {
            actionId: "launchpad.toggle-tls",
            icon: LockIcon,
            handler: () => {
                const state = get(launchpadStore);
                const id = state.selectedLaunchpadId;
                if (id) launchpadStore.setUseHttps(id, !(state.draftsByLaunchpad[id]?.useHttps ?? true));
            },
        },
        { actionId: "launchpad.launch", icon: PlayIcon, handler: launch },
        { actionId: "launchpad.cancel-launch", icon: CircleStopIcon, handler: cancelLaunch },
        {
            actionId: "launchpad.view-notes",
            icon: PenIcon,
            handler: () => toggleEntryModal("Notes", "launchpad.view-notes", GetNote, "Notes"),
        },
        {
            actionId: "launchpad.view-metadata",
            icon: BracesIcon,
            handler: () => toggleEntryModal("Metadata", "launchpad.view-metadata", GetMetadata, "Metadata"),
        },
        { actionId: "launchpad.copy-browser-view-url", icon: GlobeIcon, handler: copyOpenBrowserView },
    ];
    useMenuActions(launchpadMenu);
</script>

<svelte:window on:keydown={onKeydown} />
<MarasiKeys menuOptions={launchpadMenu} />

<div class="relative flex h-full min-h-0">
    <LaunchpadDock bind:this={dock} store={launchpadStore} {searchInput}>
        <LaunchpadTree
            bind:this={tree}
            bind:groupByStatus
            store={launchpadStore}
            pickLaunchpad={(id) => launchpadStore.selectLaunchpad(id)}
            {pickEntry}
            {moveEntries}
            {openEntryMenu}
            {openLaunchpadMenu}
            menuLaunchpadId={rowLaunchpadMenu.open ? rowLaunchpadMenu.launchpadId : null}
            bind:searchInput
        />
    </LaunchpadDock>
    <div class="min-w-0 flex-1">
        <LaunchpadWorkspace
            bind:this={workspace}
            store={launchpadStore}
            onEditorFocus={() => dock?.onEditorFocus()}
            onLaunch={launch}
            onCancel={cancelLaunch}
            onDelete={deleteOpenLaunchpad}
            onBrowserView={copyOpenBrowserView}
            launchDisabled={!$listener.status}
        />
    </div>
</div>

<RowMenu
    bind:open={entryMenu.open}
    x={entryMenu.x}
    y={entryMenu.y}
    pairs={entryMenuEntries}
    items={entryMenuData ? entryMenuFor(entryMenuData) : []}
    context={{ numberOf: (entry) => entryMenuData.entries.indexOf(entry) + 1 }}
    noun={["entry", "entries"]}
    scope={entryMenuName ? `in ${entryMenuName}` : null}
    on:action={(e) => runEntryAction(e.detail)}
    on:close={(e) => e.detail.refocus && tree?.focus()}
/>

<RowMenu
    bind:open={rowLaunchpadMenu.open}
    x={rowLaunchpadMenu.x}
    y={rowLaunchpadMenu.y}
    pairs={launchpadMenuData?.entries ?? []}
    items={launchpadMenuData ? launchpadMenuFor(launchpadMenuData) : []}
    context={{ numberOf: (entry) => launchpadMenuData.entries.indexOf(entry) + 1 }}
    noun={["entry", "entries"]}
    scope={launchpadMenuData ? `in ${launchpadMenuData.launchpad.Name || UNTITLED_LAUNCHPAD}` : null}
    on:action={(e) => runLaunchpadAction(e.detail)}
    on:close={(e) => e.detail.refocus && tree?.focus()}
/>
