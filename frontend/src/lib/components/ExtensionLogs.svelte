<script>
    import { onMount } from "svelte";
    import { extensionsStore } from "../../stores/extensionsStore.js";

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
<div class="text-center p-1 text-sm font-bold">
    {extensionName} Logs
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
{/if}