<script>
    import { onDestroy } from "svelte";
    import { extensions_ui } from "../../stores.js";
    import SchemaRenderer from "./Renderer.svelte";
    import { EventsEmit } from "../wailsjs/runtime/runtime.js";

    export let enableSync = false;
    export let extensionData;
    export let schema;
    export let classes = "";

    onDestroy(() => {
        if (enableSync) {
            const currentState =
                $extensions_ui[extensionData.Name]?.state || {};

            if (Object.keys(currentState).length > 0) {
                EventsEmit("extension_sync_state", {
                    extensionID: extensionData.ID,
                    args: [currentState],
                });
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
