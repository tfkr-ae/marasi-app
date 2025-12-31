<script>
    import { getDrawerStore } from "@skeletonlabs/skeleton";
    import Renderer from "../Renderer.svelte";
    import { X } from "lucide-svelte";

    const drawerStore = getDrawerStore();

    $: meta = $drawerStore.meta;
    $: title = meta?.title || "Extension Drawer";
    $: schema = meta?.schema;
    $: extensionData = meta?.extensionData;
    $: classes = meta?.classes || "p-4";

    function close() {
        drawerStore.close();
    }
</script>

{#if schema && extensionData}
    <div class="h-full flex flex-col {classes}">
        <header
            class="flex justify-between items-center mb-4 pb-2 border-b border-surface-500/30"
        >
            <h3 class="h3 font-bold">{title}</h3>
            <button
                class="btn-icon btn-icon-sm variant-soft-surface"
                on:click={close}
            >
                <X size={18} />
            </button>
        </header>

        <div class="flex-1 overflow-y-auto">
            <Renderer {schema} {extensionData} />
        </div>
    </div>
{:else}
    <div class="p-4">
        <p>No content defined for this drawer.</p>
    </div>
{/if}
