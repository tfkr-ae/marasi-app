<script>
    import { onMount } from "svelte";
    import { GetExtensionLogs } from "../wailsjs/go/main/App";
    import { EventsOff, EventsOn } from "../wailsjs/runtime/runtime";

    export let extensionName = "";
    let logs = [];
    onMount(() => {
        GetExtensionLogs(extensionName).then((extensionLogs) => {
            logs = extensionLogs;
            EventsOn(extensionName + "-log", (log) => {
                console.log("new log ", log);
                if (logs?.length > 0) {
                    logs = [...logs, log];
                } else {
                    logs = [log];
                }
            });
        }).catch((err) => {
            console.log(err);
        })
        return () => {
            EventsOff(extensionName + "-log");
        }
    })
</script>
<div class="text-center p-1">
    {extensionName} Logs
</div>
{#if logs?.length > 0}
    {#each logs as log}
        <pre class="pre text-xs p-0">[{new Date(log.Time).toLocaleString("en-US", {
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