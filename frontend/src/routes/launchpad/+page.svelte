<script>
    import {
        Accordion,
        AccordionItem,
        getModalStore,
        getToastStore,
        ProgressRadial,
        SlideToggle,
    } from "@skeletonlabs/skeleton";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        ArrowDownIcon,
        ArrowLeftIcon,
        ArrowRightIcon,
        BracesIcon,
        ChevronLeftIcon,
        ChevronRightIcon,
        LockIcon,
        PenIcon,
        PlayIcon,
        SendIcon,
        SettingsIcon,
        ToggleLeftIcon,
        TrashIcon,
    } from "lucide-svelte";
    import { page } from "$app/stores";
    import {
        activeLaunchpadID,
        currentEntryIndex,
        launchpads,
        populateLaunchpadEntries,
        populateLaunchpads,
        listener,
    } from "../../stores";
    import { onMount } from "svelte";
    import RequestResponseView from "../../lib/components/RequestResponseView.svelte";
    import {
        DeleteLaunchpad,
        GetMetadata,
        GetNote,
        Repeat,
    } from "../../lib/wailsjs/go/main/App";
    const modalStore = getModalStore();
    const toastStore = getToastStore();
    let accOpened = false;
    let useHttps = true;
    let isSending = false;

    $: if ($launchpads.length > 0) {
        const isValid = $launchpads.some((l) => l.ID == $activeLaunchpadID);
        if (!$activeLaunchpadID || !isValid) {
            $activeLaunchpadID = $launchpads[0].ID;
            $currentEntryIndex = 0;
        }
    }

    $: activeLaunchpad = $launchpads.find(
        (launchpad) => launchpad.ID == $activeLaunchpadID,
    );

    $: activeEntries = (activeLaunchpad && activeLaunchpad.Entries) || [];

    $: currentLaunchpadIndex = $launchpads.findIndex(
        (launchpad) => launchpad.ID == $activeLaunchpadID,
    );

    $: if (
        activeEntries.length > 0 &&
        $currentEntryIndex >= activeEntries.length
    ) {
        $currentEntryIndex = activeEntries.length - 1;
    }

    $: currentEntry =
        activeEntries.length > 0 && $currentEntryIndex < activeEntries.length
            ? activeEntries[$currentEntryIndex]
            : {};

    $: if (
        $activeLaunchpadID &&
        activeLaunchpad &&
        activeEntries.length === 0
    ) {
        populateLaunchpadEntries($activeLaunchpadID);
    }

    function navLaunchpad(dir) {
        const nextIdx = currentLaunchpadIndex + dir;
        if (nextIdx >= 0 && nextIdx < $launchpads.length) {
            $activeLaunchpadID = $launchpads[nextIdx].ID;
            $currentEntryIndex = 0;
        }
    }

    function navEntry(dir) {
        const nextIdx = $currentEntryIndex + dir;
        if (nextIdx >= 0 && nextIdx < activeEntries.length) {
            $currentEntryIndex = nextIdx;
        }
    }

    async function sendRequest() {
        if (!currentEntry?.ID || !$activeLaunchpadID) return;

        if (!$listener.status) {
            toastStore.trigger({
                message: "Listener is offline.",
                background: "variant-filled-error",
            });
            return;
        }

        if (isSending) return;

        try {
            isSending = true;

            await Repeat(currentEntry.Body, $activeLaunchpadID, useHttps);

            await populateLaunchpadEntries($activeLaunchpadID);

            toastStore.trigger({
                message: "Request launched",
                background: "variant-filled-success",
            });
            $currentEntryIndex = activeEntries.length - 1;
        } catch (err) {
            console.error("Launchpad error:", err);
            toastStore.trigger({
                message: "Failed to send request",
                background: "variant-filled-error",
            });
        } finally {
            isSending = false;
        }
    }
    onMount(async () => {
        await populateLaunchpads();

        const urlID = $page.url.searchParams.get("id");
        const exists = $launchpads.some((l) => l.ID == urlID);

        if (urlID && exists) {
            $activeLaunchpadID = urlID;
        }
    });

    const launchpadMenu = [
        {
            name: "Toggle Launchpad Settings",
            subtitle: "Toggle Settings Accordian",
            keywords: "settings, toggle",
            icon: ToggleLeftIcon,
            action: {
                handler: () => (accOpened = !accOpened),
                options: { scope: "launchpad", single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        {
            name: "Next Tab",
            subtitle: "Go to next Launchpad tab",
            keywords: "next, tab",
            icon: ArrowRightIcon,
            action: {
                handler: () => navLaunchpad(1),
                options: { scope: "launchpad", single: true },
                keys: ["⌘+]", "ctrl+]"],
            },
        },
        {
            name: "Previous Tab",
            subtitle: "Go to previous Launchpad tab",
            keywords: "previous, tab",
            icon: ArrowLeftIcon,
            action: {
                handler: () => navLaunchpad(-1),
                options: { scope: "launchpad", single: true },
                keys: ["⌘+[", "ctrl+["],
            },
        },
        {
            name: "Next Entry",
            subtitle: "Go to next Launchpad entry",
            keywords: "next, entry, tab",
            icon: ArrowDownIcon,
            action: {
                handler: () => navEntry(1),
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+]", "ctrl+⇧+]"],
            },
        },
        {
            name: "Previous Entry",
            subtitle: "Go to previous Launchpad entry",
            keywords: "previous, entry, tab",
            icon: ArrowDownIcon,
            action: {
                handler: () => navEntry(-1),
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+[", "ctrl+⇧+["],
            },
        },
        {
            name: "Delete Tab",
            subtitle: "Delete Current Launchpad Tab",
            keywords: "delete, tab",
            icon: TrashIcon,
            action: {
                handler: () => {
                    if (!activeLaunchpad) return;
                    modalStore.trigger({
                        type: "confirm",
                        title: `Deleting ${activeLaunchpad.Name}`,
                        body: "Are you sure you wish to proceed?",
                        response: (r) => {
                            if (r) {
                                DeleteLaunchpad($activeLaunchpadID).then(() => {
                                    populateLaunchpads();
                                });
                            }
                        },
                    });
                },
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+D", "ctrl+⇧+D"],
            },
        },
        {
            name: "Edit Request",
            subtitle: "Edit Current Entry Request",
            keywords: "edit, entry, request",
            icon: PenIcon,
            action: {
                handler: () => {
                    const cmContent = document.querySelector(
                        'div[data-language="http"]',
                    );
                    if (cmContent) cmContent.focus();
                },
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+E", "ctrl+⇧+E"],
            },
        },
        {
            name: "Toggle TLS",
            subtitle: "Toggle TLS Flag",
            keywords: "toggle, tls, https",
            icon: LockIcon,
            action: {
                handler: () => (useHttps = !useHttps),
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+T+T+T+T+T+T+T+T+T+T+T+T", "ctrl+⇧+T"],
            },
        },
        {
            name: "Launch",
            subtitle: "Send request through proxy",
            keywords: "send, launchpad, repeat",
            icon: PlayIcon,
            action: {
                handler: sendRequest,
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+L", "ctrl+⇧+L"],
            },
        },
        {
            name: "View Notes",
            subtitle: "View or edit request notes",
            keywords: "notes",
            icon: PenIcon,
            action: {
                handler: () => {
                    if (!currentEntry?.ID) return;
                    GetNote(currentEntry.ID).then((note) => {
                        const modal = {
                            type: "component",
                            component: "Notes",
                            title: `Request ${$currentEntryIndex + 1} Notes`,
                            content: note,
                            requestID: currentEntry.ID,
                        };
                        if (!$modalStore[0]) {
                            modalStore.trigger(modal);
                        } else if ($modalStore[0].component === "Notes") {
                            modalStore.close();
                        }
                    });
                },
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+N", "ctrl+⇧+N"],
            },
        },
        {
            name: "View Metadata",
            subtitle: "View request Metadata",
            keywords: "metadata",
            icon: BracesIcon,
            action: {
                handler: () => {
                    if (!currentEntry?.ID) return;
                    GetMetadata(currentEntry.ID).then((metadata) => {
                        const modal = {
                            type: "component",
                            component: "Metadata",
                            title: `Request ${$currentEntryIndex + 1} Metadata`,
                            content: metadata,
                            requestID: currentEntry.ID,
                        };
                        if (!$modalStore[0]) {
                            modalStore.trigger(modal);
                        } else if ($modalStore[0].component === "Metadata") {
                            modalStore.close();
                        }
                    });
                },
                options: { scope: "launchpad", single: true },
                keys: ["⌘+⇧+M", "ctrl+⇧+M"],
            },
        },
    ];
</script>

<MarasiKeys scope="launchpad" menuOptions={launchpadMenu} />

<Accordion rounded="none">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Launchpad Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <div class="p-1">
                {activeLaunchpad?.Description || "No description"}
            </div>
        </svelte:fragment>
    </AccordionItem>
</Accordion>
<div>
    {#if $launchpads.length === 0}
        <div class="flex flex-col items-center justify-center mt-12 opacity-50">
            <h3 class="text-xl font-bold">No Launchpads</h3>
            <p>Create one from ledger.</p>
        </div>
    {:else if activeLaunchpad}
        <div
            class="flex justify-between items-center bg-surface-800/50 p-4 mb-4"
        >
            <button
                class="btn variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500"
                on:click={() => navLaunchpad(-1)}
                disabled={currentLaunchpadIndex === 0}
            >
                <ChevronLeftIcon size={24} />
            </button>

            <div class="text-center">
                <h2 class="font-bold text-xl">{activeLaunchpad.Name}</h2>
                <small class="opacity-70"
                    >{currentLaunchpadIndex + 1} of {$launchpads.length}</small
                >
            </div>

            <button
                class="btn variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500"
                on:click={() => navLaunchpad(1)}
                disabled={currentLaunchpadIndex >= $launchpads.length - 1}
            >
                <ChevronRightIcon size={24} />
            </button>
        </div>
        {#if activeEntries.length === 0}
            <div class="text-center py-10 opacity-50">
                <p>No requests loaded in this launchpad.</p>
            </div>
        {:else}
            <div
                class="flex justify-between items-center bg-surface-800/50 p-4 mb-4"
            >
                <button
                    class="btn variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500"
                    on:click={() => navEntry(-1)}
                    disabled={$currentEntryIndex === 0}
                >
                    <ArrowLeftIcon size={18} />
                </button>
                <span class="text-sm font-bold"
                    >Request {$currentEntryIndex + 1} of {activeEntries.length}</span
                >
                <button
                    class="btn variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500"
                    on:click={() => navEntry(1)}
                    disabled={$currentEntryIndex >= activeEntries.length - 1}
                >
                    <ArrowRightIcon size={18} />
                </button>
            </div>

            <div class="card p-4 mx-4">
                <div
                    class="flex justify-center items-center gap-6 mb-4 border-b border-surface-500/20 pb-4"
                >
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-bold">HTTPS</span>
                        <SlideToggle
                            name="TLS Toggle"
                            bind:checked={useHttps}
                            size="sm"
                        />
                    </div>
                    <button
                        class="btn variant-filled-primary btn-sm"
                        on:click={sendRequest}
                        disabled={isSending || !$listener.status}
                    >
                        {#if isSending}
                            <ProgressRadial
                                width="w-4"
                                stroke={100}
                                meter="stroke-surface-50"
                                track="stroke-surface-500/30"
                            />
                            <span class="ml-2">Sending...</span>
                        {:else}
                            <SendIcon size={16} class="mr-2" /> Send
                        {/if}
                    </button>
                </div>

                {#if currentEntry?.ID}
                    {#key currentEntry.ID}
                        <RequestResponseView
                            request_id={currentEntry.ID}
                            titleText={"Request " + ($currentEntryIndex + 1)}
                            bind:requestBody={currentEntry.Body}
                            requestReadOnly={false}
                        />
                    {/key}
                {/if}
            </div>
        {/if}
    {/if}
</div>
