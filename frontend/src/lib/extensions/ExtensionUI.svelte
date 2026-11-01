<script>
    import { onDestroy } from "svelte";
    import { extensions_ui } from "../../stores.js";
    import SchemaRenderer from "./Renderer.svelte";
    import { extensionsStore } from "../../stores/extensionsStore.js";

    export let enableSync = false;
    export let extensionData;
    export let schema;
    export let classes = "";

    onDestroy(() => {
        if (enableSync) {
            const currentState =
                $extensions_ui[extensionData.Name]?.state || {};

            if (Object.keys(currentState).length > 0) {
                // v1's extension_sync_state: the extension's sync(state).
                extensionsStore
                    .call(extensionData.ID, "sync", [currentState])
                    .catch((error) => console.error(`Syncing ${extensionData.Name} failed:`, error));
            }
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
