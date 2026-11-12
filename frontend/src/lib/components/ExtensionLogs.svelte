<script>
    import { onMount } from "svelte";
    import { getDrawerStore } from "@skeletonlabs/skeleton";
    import { X } from "lucide-svelte";
    import { extensionsStore } from "../../stores/extensionsStore.js";
    import { mobile } from "../platform.js";

    const drawerStore = getDrawerStore();

    export let extensionName = "";
    let logs = [];
    // The extension's stored lines, then each extension.log as it prints.
    onMount(() => {
        let stop = () => {};
        let gone = false;
        extensionsStore
            .watchLogs(extensionName, (lines) => (logs = lines))
            .then((stopWatching) => {
                stop = stopWatching;
                if (gone) stop();
            })
            .catch((err) => console.error(`Reading ${extensionName} logs failed:`, err));
        return () => {
            gone = true;
            stop();
        };
    });
</script>
<!-- On iOS the drawer is a full-screen sheet (app.css) with no backdrop
     to tap, so its title row carries a close button. -->
<div class="extension-logs-head relative p-1 text-center text-sm font-bold" class:mobile-logs-head={$mobile}>
    {extensionName} Logs
    {#if $mobile}
        <button
            type="button"
            class="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center opacity-70"
            aria-label="Close"
            on:click={() => drawerStore.close()}><X size={18} /></button
        >
    {/if}
</div>
{#if logs?.length > 0}
    {#each logs as log}
        <pre class="pre text-xs p-0 bg-surface-50 text-surface-900 dark:bg-surface-900 dark:text-surface-50">[{new Date(log.Time).toLocaleString("en-US", {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                    timeZoneName: 'short'
                                }
                                )}] - {log.Text.trim()}
        </pre>
    {/each}
{:else if $mobile}
    <p class="p-8 text-center text-xs opacity-60">No logs yet</p>
{/if}