<script>
    import { DataHandler } from "@vincjo/datatables";
    import { logItems } from "../../stores";
    import Sort from "./datatables/Sort.svelte";
    import { onMount } from "svelte";
    import { GetExtensions } from "../wailsjs/go/main/App";
    export const extensionsMap = {};
    const handler = new DataHandler(Object.values($logItems), { rowsPerPage: 200 });
    $: handler.setRows(Object.values($logItems).toReversed());
    $: rows = handler.getRows();
    onMount(() => {
        GetExtensions().then((exts) => {
            Object.values(exts).forEach((ext) => {
                extensionsMap[ext.ID] = ext.Name;
            });
        });
    })
</script>

<div class="table-container">
    <table class="table table-auto w-full">
        <thead>
            <tr>
                <th>
                    <Sort {handler} orderBy={(row) => {return $logItems.indexOf(row)}}>ID</Sort>
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
                    <td class="id-cell">{$logItems.indexOf(row) + 1}</td>
                    <td class="level-cell">{row.Level}</td>
                    <td class="message-cell">{row.Message}</td>
                    <td class="req-resp-cell">{row.RequestID.Valid ? row.RequestID.String : ''}</td>
                    <td class="extension-cell">{row.ExtensionID.Valid ? extensionsMap[row.ExtensionID.String]: ''}</td>
                    <td class="timestamp-cell">{new Date(row.Timestamp).toLocaleString('en-GB', {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                      })}</td>
                </tr>
            {/each}
        </tbody>
    </table>
</div>

<style>
    /* Make the header centered and clean */
    thead th {
        text-align: center;
        padding: 4px;
        line-height: normal;
        border-bottom: 1px solid #cf595b;
        white-space: nowrap;
    }

    /* General table styling */
    .table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.9rem;
    }

    tbody td {
        vertical-align: middle;
        padding: 0.5em;
        line-height: 1.2;
        border: 1px solid #2f343c;
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
        background-color: #2f343c;
        cursor: pointer;
    }
</style>