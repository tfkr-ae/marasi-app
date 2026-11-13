<script>
    import { DataHandler } from "@vincjo/datatables";
    import { homeStore } from "../../stores/homeStore";
    import Sort from "./datatables/Sort.svelte";
    // The service's log, oldest first, newest shown first; log.added lines
    // join it live (homeStore). `compact` (the iOS app's Home) draws it as a
    // list in a card, sized to a phone, instead of the wide table.
    export let compact = false;
    $: logItems = $homeStore.logs;
    $: extensionsMap = $homeStore.extensionNames;
    const handler = new DataHandler([], {
        rowsPerPage: 200,
    });
    $: handler.setRows(logItems.toReversed());
    $: rows = handler.getRows();
    const levelTone = {
        ERROR: "text-error-600 dark:text-error-400",
        WARN: "text-warning-700 dark:text-warning-400",
        WARNING: "text-warning-700 dark:text-warning-400",
    };
    const shortTimestamp = (at) =>
        new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
</script>

{#if compact}
<section class="card overflow-hidden bg-surface-100-500-token text-surface-900-50-token" data-testid="home-log">
    <h3 class="border-b border-surface-300 px-3 py-2 text-sm font-bold dark:border-surface-600">Log</h3>
    {#each logItems.toReversed() as row}
        <div class="flex items-baseline gap-3 border-b border-surface-300/60 px-3 py-2 text-xs last:border-b-0 dark:border-surface-600/60">
            <span class="w-10 shrink-0 font-semibold {levelTone[row.Level] ?? 'opacity-60'}">{row.Level}</span>
            <span class="min-w-0 flex-1 break-words">
                {row.Message}
                {#if row.ExtensionID || row.RequestID}
                    <span class="block opacity-60">{[row.ExtensionID ? extensionsMap[row.ExtensionID] : "", row.RequestID ? `Request ${row.RequestID}` : ""].filter(Boolean).join(" · ")}</span>
                {/if}
            </span>
            <span class="shrink-0 font-mono opacity-60">{shortTimestamp(row.Timestamp)}</span>
        </div>
    {:else}
        <p class="px-3 py-2 text-xs opacity-60">No log lines yet.</p>
    {/each}
</section>
{:else}
<div class="table-container">
    <table class="table table-dense table-auto w-full">
        <thead>
            <tr>
                <th>
                    <Sort
                        {handler}
                        orderBy={(row) => {
                            return logItems.indexOf(row);
                        }}>ID</Sort
                    >
                </th>
                <th>Level</th>
                <th>Message</th>
                <th>Request Response ID</th>
                <th>Extension</th>
                <th>Timestamp</th>
            </tr>
        </thead>
        <tbody>
            {#each $rows as row}
                <tr>
                    <td class="id-cell">{logItems.indexOf(row) + 1}</td>
                    <td class="level-cell">{row.Level}</td>
                    <td class="message-cell">{row.Message}</td>
                    <td class="req-resp-cell"
                        >{row.RequestID ? row.RequestID : ""}</td
                    >
                    <td class="extension-cell"
                        >{row.ExtensionID
                            ? extensionsMap[row.ExtensionID]
                            : ""}</td
                    >
                    <td class="timestamp-cell"
                        >{new Date(row.Timestamp).toLocaleString("en-GB", {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                        })}</td
                    >
                </tr>
            {/each}
        </tbody>
    </table>
</div>
{/if}

<style>
    /* Make the header centered and clean */
    thead th {
        text-align: center;
        padding: 4px;
        line-height: normal;
        border-bottom: 1px solid rgb(var(--color-primary-500));
        background-color: rgb(var(--color-surface-50));
        white-space: nowrap;
    }

    /* General table styling */
    .table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.9rem;
    }

    tbody tr,
    tbody tr:nth-child(even),
    tbody tr:nth-child(odd) {
        background-color: rgb(var(--color-surface-50));
    }

    tbody td {
        vertical-align: middle;
        padding: 0.5em;
        line-height: 1.2;
        border: 1px solid rgb(var(--color-surface-300));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Make fixed-width columns shrink to content */
    .id-cell,
    .level-cell,
    .req-resp-cell,
    .extension-cell,
    .timestamp-cell {
        width: 1%; /* Forces these columns to shrink to fit content */
        text-align: center; /* Center their content */
        padding: 0.5em;
    }

    /* Message cell takes remaining space and allows wrapping */
    .message-cell {
        width: auto; /* Expands to fill remaining space */
        text-align: left;
        max-width: 50em;
        white-space: normal; /* Allow text to wrap */
        word-wrap: break-word;
    }

    .table-container {
        width: 100%;
        overflow-x: auto;
    }

    /* Make rows hoverable */
    tbody tr:hover {
        background-color: rgb(var(--color-surface-200));
        cursor: pointer;
    }

    :global(.dark) thead th,
    :global(.dark) tbody tr,
    :global(.dark) tbody tr:nth-child(even),
    :global(.dark) tbody tr:nth-child(odd) {
        background-color: rgb(var(--color-surface-900));
    }

    :global(.dark) tbody td {
        border-color: rgb(var(--color-surface-600));
    }

    :global(.dark) tbody tr:hover {
        background-color: rgb(var(--color-surface-700));
    }
</style>
