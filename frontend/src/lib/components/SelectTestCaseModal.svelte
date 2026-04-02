<script>
    import {
        Autocomplete,
        getModalStore,
        getToastStore,
    } from "@skeletonlabs/skeleton";
    import { X } from "lucide-svelte";
    import { testCaseStore } from "../../stores/testCaseStore";
    const modalStore = getModalStore();
    const toastStore = getToastStore();
    const placeholder = "Search for existing test case...";

    export let parent;
    let input = "";
    let requestID = $modalStore[0]?.meta?.requestID ?? "";
    let mode = $modalStore[0]?.meta?.mode ?? "link";

    $: autocompleteOptions = [...$testCaseStore]
        .reverse()
        .filter((tc) => {
            if (mode === "unlink") {
                return tc.Requests?.includes(requestID);
            }

            return !tc.Requests?.includes(requestID);
        })
        .map((tc, i) => ({
            label: `${i + 1} - ${tc.Title}`,
            value: tc.ID,
            ...tc,
        }));
    const filter = () => {
        const inputFormatted = input.toLowerCase().trim();
        if (!inputFormatted) return autocompleteOptions;
        return autocompleteOptions.filter((opt) =>
            opt.label.toLowerCase().includes(inputFormatted),
        );
    };
</script>

{#if $modalStore[0]}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="card p-4 w-[65%] max-w-[95vw] shadow-xl rounded-0 flex flex-col max-h-[90vh]"
        on:keydown={(event) => {
            if (event.key === "Escape") {
                event.stopImmediatePropagation();
                modalStore.close();
            }
        }}
    >
        <header class="flex justify-between items-center p-2">
            <h2 class="text-xl font-bold">
                {mode === "link" ? "Link to" : "Unlink from"} test case
            </h2>
            <button
                class="text-2xl leading-none focus:outline-none"
                tabindex="-1"
                on:click={modalStore.close}
            >
                <X />
            </button>
        </header>
        <input
            class="input"
            type="search"
            name="search"
            bind:value={input}
            {placeholder}
            autocomplete="off"
        />

        {#if autocompleteOptions.length > 0}
            <div
                class="card p-2 w-full max-h-[200px] overflow-y-auto mt-1 shadow-xl border border-surface-500 z-10"
            >
                <Autocomplete
                    bind:input
                    options={autocompleteOptions}
                    {filter}
                    on:selection={async (e) => {
                        const selectedTestCase = e.detail;
                        const selectedID = selectedTestCase.ID;
                        input = "";

                        try {
                            if (mode === "link") {
                                if (
                                    selectedTestCase.Requests?.includes(
                                        requestID,
                                    )
                                ) {
                                    toastStore.trigger({
                                        message: "Already linked",
                                        background: "variant-filled-warning",
                                    });
                                } else {
                                    await testCaseStore.linkRequest(
                                        selectedID,
                                        requestID,
                                    );
                                    toastStore.trigger({
                                        message: "Linked successfully",
                                        background: "variant-filled-success",
                                    });
                                }
                            } else {
                                if (
                                    !selectedTestCase.Requests?.includes(
                                        requestID,
                                    )
                                ) {
                                    toastStore.trigger({
                                        message: "Not currently linked",
                                        background: "variant-filled-warning",
                                    });
                                } else {
                                    await testCaseStore.unlinkRequest(
                                        selectedID,
                                        requestID,
                                    );
                                    toastStore.trigger({
                                        message: "Unlinked successfully",
                                        background: "variant-filled-success",
                                    });
                                }
                            }
                        } catch (err) {
                            toastStore.trigger({
                                message: `Error: ${err.message}`,
                                background: "variant-filled-error",
                            });
                        }

                        modalStore.close();
                    }}
                />
            </div>
        {:else}
            <div class="p-4 text-center opacity-50 italic">
                No test cases found.
            </div>
        {/if}
    </div>
{/if}
