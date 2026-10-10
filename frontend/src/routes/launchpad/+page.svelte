<script>
    import {
        Accordion,
        AccordionItem,
        getModalStore,
        getToastStore,
        ProgressRadial,
        SlideToggle,
        modeCurrent,
    } from "@skeletonlabs/skeleton";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import { useMenuActions } from "../../lib/keybindings/app.js";
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
    import { beforeNavigate, goto } from "$app/navigation";
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
    let userEdited = false;

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

    function confirmLeave(onConfirm) {
        if (!userEdited) {
            onConfirm();
            return;
        }
        modalStore.trigger({
            type: "confirm",
            title: "Confirm Action",
            body: "You have made changes to the text. Navigating away will clear your changes. Continue?",
            response: (result) => {
                if (result) {
                    userEdited = false;
                    onConfirm();
                }
            },
        });
    }

    function navLaunchpad(dir) {
        const nextIdx = currentLaunchpadIndex + dir;
        if (nextIdx >= 0 && nextIdx < $launchpads.length) {
            confirmLeave(() => {
                $activeLaunchpadID = $launchpads[nextIdx].ID;
                $currentEntryIndex = 0;
            });
        }
    }

    function navEntry(dir) {
        const nextIdx = $currentEntryIndex + dir;
        if (nextIdx >= 0 && nextIdx < activeEntries.length) {
            confirmLeave(() => {
                $currentEntryIndex = nextIdx;
            });
        }
    }

    beforeNavigate(({ to, cancel }) => {
        if (!userEdited) return;
        cancel();
        confirmLeave(() => {
            if (to) goto(to.url.pathname + to.url.search);
        });
    });

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

            userEdited = false;
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
            actionId: "launchpad.toggle-settings",
            icon: ToggleLeftIcon,
            handler: () => (accOpened = !accOpened),
        },
        {
            actionId: "launchpad.next-tab",
            icon: ArrowRightIcon,
            handler: () => navLaunchpad(1),
        },
        {
            actionId: "launchpad.previous-tab",
            icon: ArrowLeftIcon,
            handler: () => navLaunchpad(-1),
        },
        {
            actionId: "launchpad.next-entry",
            icon: ArrowDownIcon,
            handler: () => navEntry(1),
        },
        {
            actionId: "launchpad.previous-entry",
            icon: ArrowDownIcon,
            handler: () => navEntry(-1),
        },
        {
            actionId: "launchpad.delete-tab",
            icon: TrashIcon,
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
        },
        {
            actionId: "launchpad.edit-request",
            icon: PenIcon,
            handler: () => {
                const cmContent = document.querySelector(
                    'div[data-language="http"]',
                );
                if (cmContent) cmContent.focus();
            },
        },
        {
            actionId: "launchpad.toggle-tls",
            icon: LockIcon,
            handler: () => (useHttps = !useHttps),
        },
        {
            actionId: "launchpad.launch",
            icon: PlayIcon,
            handler: sendRequest,
        },
        {
            actionId: "launchpad.view-notes",
            icon: PenIcon,
            handler: () => {
                if (!currentEntry?.ID) return;
                GetNote(currentEntry.ID).then((note) => {
                    const modal = {
                        type: "component",
                        component: "Notes",
                        toggleAction: "launchpad.view-notes",
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
        },
        {
            actionId: "launchpad.view-metadata",
            icon: BracesIcon,
            handler: () => {
                if (!currentEntry?.ID) return;
                GetMetadata(currentEntry.ID).then((metadata) => {
                    const modal = {
                        type: "component",
                        component: "Metadata",
                        toggleAction: "launchpad.view-metadata",
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
        },
    ];
    useMenuActions(launchpadMenu);
</script>

<MarasiKeys menuOptions={launchpadMenu} />

<Accordion rounded="none" class="bg-surface-50 dark:bg-surface-900 text-surface-900-50-token">
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
            class="flex justify-between items-center bg-surface-200 dark:bg-surface-800/50 p-4 mb-4"
        >
            <button
                class="btn {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500'}"
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
                class="btn {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500'}"
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
                class="flex justify-between items-center bg-surface-200 dark:bg-surface-800/50 p-4 mb-4"
            >
                <button
                    class="btn {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500'}"
                    on:click={() => navEntry(-1)}
                    disabled={$currentEntryIndex === 0}
                >
                    <ArrowLeftIcon size={18} />
                </button>
                <span class="text-sm font-bold"
                    >Request {$currentEntryIndex + 1} of {activeEntries.length}</span
                >
                <button
                    class="btn {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary hover:bg-primary-800 disabled:bg-surface-500'}"
                    on:click={() => navEntry(1)}
                    disabled={$currentEntryIndex >= activeEntries.length - 1}
                >
                    <ArrowRightIcon size={18} />
                </button>
            </div>

            <div class="card p-4 mx-4 bg-surface-50 dark:bg-surface-800">
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
                        class="btn btn-sm {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
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
                            bind:userEdited
                            requestReadOnly={false}
                        />
                    {/key}
                {/if}
            </div>
        {/if}
    {/if}
</div>
