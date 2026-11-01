<script>
    import { onMount } from "svelte";
    import { GetExtensionLogs } from "../bindings/App";
    import { extensionsStore } from "../../stores/extensionsStore.js";

    export let extensionName = "";
    let logs = [];
    onMount(() => {
        // Lines printed while the buffer is read are kept after it, unless
        // the buffer has them too.
        let live = [];
        let read = false;
        const stop = extensionsStore.followLogs(extensionName, (log) => {
            if (read) logs = [...logs, log];
            else live = [...live, log];
        });
        GetExtensionLogs(extensionName)
            .then((extensionLogs) => {
                const buffered = extensionLogs ?? [];
                const seen = new Set(buffered.map((log) => `${log.Time}\n${log.Text}`));
                logs = [...buffered, ...live.filter((log) => !seen.has(`${log.Time}\n${log.Text}`))];
            })
            .catch((err) => {
                console.error(`Reading the ${extensionName} logs failed:`, err);
                logs = live;
            })
            .finally(() => {
                read = true;
            });
        return stop;
    })
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