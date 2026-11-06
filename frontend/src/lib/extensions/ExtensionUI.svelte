<script>
    import { onDestroy } from "svelte";
    import SchemaRenderer from "./Renderer.svelte";
    import { extensionsStore } from "../../stores/extensionsStore.js";

    export let enableSync = false;
    export let extensionData;
    export let schema;
    export let classes = "";

    onDestroy(() => {
        if (enableSync && extensionData) {
            extensionsStore
                .sync(extensionData.Name)
                .catch((err) => console.error(`Syncing ${extensionData.Name} failed:`, err));
        }
    });
</script>

<div class="extension-wrapper max-w-full {classes}">
    <SchemaRenderer {schema} {extensionData} />
</div>

<style>
    .extension-wrapper {
        contain: layout paint;
    }
</style>
