<script>
    import { getModalStore } from "@skeletonlabs/skeleton";
    import Renderer from "../Renderer.svelte";

    export let parent;

    const modalStore = getModalStore();

    $: meta = $modalStore[0]?.meta;
    $: title = meta?.title || "Extension Modal";
    $: schema = meta?.schema;
    $: extensionData = meta?.extensionData;

    function onClose() {
        parent.onClose();
    }
</script>

{#if $modalStore[0]}
    <div class="card p-4 w-modal shadow-xl space-y-4">
        <header class="text-2xl font-bold">
            {title}
        </header>

        <div class="article max-h-[60vh] overflow-y-auto">
            {#if schema && extensionData}
                <Renderer {schema} {extensionData} />
            {:else}
                <p>No content defined for this modal.</p>
            {/if}
        </div>

        <footer class="modal-footer flex justify-end space-x-2">
            <button class="btn btn-neutral" on:click={onClose}>Close</button>
        </footer>
    </div>
{/if}
