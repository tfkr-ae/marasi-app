<script>
    import { getDrawerStore, getModalStore } from "@skeletonlabs/skeleton";
    import { UpdateNote } from "../wailsjs/go/main/App";
    import { onDestroy, onMount } from "svelte";
    import { populateHistory } from "../../stores";
    import { X } from "lucide-svelte";

    export let parent;
    let content;
    let requestId;
    let isSaved = false;
    let loading = false; // Add a loading state

    const modalStore = getModalStore();
    const drawerStore = getDrawerStore();

    const cBase = 'card p-4 w-modal shadow-xl space-y-4';
    const cHeader = 'text-2xl font-bold';
    const cForm = 'space-y-4';

    function saveNote() {
        UpdateNote($modalStore[0].requestID.toString(), content).then(() => {
            isSaved = true;
            populateHistory();
            modalStore.close();
        }).catch((noteError) => {
            console.log(noteError)
            populateHistory();
            // Do I want to close here?
            isSaved = true;
            modalStore.close()
        });
    }

    onMount(() => {
        content = $modalStore[0].content;
        requestId = $modalStore[0].requestID.toString();
    });

    onDestroy(() => {
        // If the note wasn't manually saved, then save it
        if (!isSaved) {
            UpdateNote(requestId, content).then(() => {
                populateHistory();
                modalStore.close();
            }).catch((noteError) => {
                console.log(noteError)
            populateHistory();
                // Do I want to close here?
                modalStore.close()
            });
        }
    })
</script>

{#if $modalStore[0]}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-example-form {cBase} rounded-0" on:keydown={(event) => {
		if (event.key === 'Escape') {
            event.stopImmediatePropagation();
            modalStore.close();
        } 
    }}>
        {#if loading}
            <!-- Show spinner when loading -->
            <div class="spinner"></div>
        {:else}
            <!-- Show modal content when not loading -->
            <header class="flex justify-between items-center">
                <h2 class="text-xl font-bold">
                    {$modalStore[0].title ?? '(title missing)'}
                </h2>
                <button class="text-2xl leading-none focus:outline-none" tabindex="-1" on:click={modalStore.close}>
                    <X />
                </button>
            </header>
            <form class="modal-form {cForm}">
                <label class="label">
                    <textarea class="textarea rounded-none" rows="10" bind:value={content} placeholder="Request notes here" />
                </label>
            </form>
            <!-- prettier-ignore -->
            <footer class="modal-footer {parent.regionFooter}">
                <button class="btn {parent.buttonPositive}" on:click={saveNote}>Save</button>
            </footer>
        {/if}
    </div>
{/if}

<style>
    .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-left-color: #cf595b;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto; /* Center the spinner */
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>