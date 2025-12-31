<script>
    import { writable } from "svelte/store";
    import {
        createSvelteTable,
        getCoreRowModel,
        getSortedRowModel,
        flexRender,
    } from "@tanstack/svelte-table";
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";

    export let extensionData;
    export let value = { bind: "" };
    export let columns = [];
    export let tableClass = "table max-w-full border-collapse";
    export let headerClass = "bg-base-200";
    export let rowClass = "hover:bg-base-100 border-t border-base-200";

    export let emptyMessage = "No records found.";

    const sortingPath = { bind: `__sort_${value.bind}` };

    $: rawData = resolveBind($extensions_ui, extensionData, value);
    $: data = Array.isArray(rawData) ? rawData : [];

    $: sorting = resolveBind($extensions_ui, extensionData, sortingPath) || [];

    $: tableColumns = columns.map((col) => ({
        accessorKey: col.accessorKey,
        header: col.header,
        enableSorting: col.sortable !== false,
        cell: (info) => {
            if (col.render === "row_num") {
                return info.row.index + 1;
            }
            return info.getValue();
        },
        sortingFn: col.sortingFn ? col.sortingFn : "text",
    }));

    const options = writable({
        data,
        columns: tableColumns,
        state: { sorting },
        onSortingChange: (updater) => {
            const next =
                typeof updater === "function" ? updater(sorting) : updater;
            updateBind(extensionData, sortingPath, next);
        },
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    $: options.update((old) => ({
        ...old,
        data,
        columns: tableColumns,
        state: { ...old.state, sorting },
    }));

    $: table = createSvelteTable(options);
</script>

<table class={tableClass}>
    <thead class={headerClass}>
        {#each $table.getHeaderGroups() as headerGroup}
            <tr>
                {#each headerGroup.headers as header}
                    <th class="px-4 py-2 text-left font-bold">
                        {#if !header.isPlaceholder}
                            <button
                                type="button"
                                class="flex items-center gap-2 w-full text-inherit font-inherit uppercase text-xs tracking-wider"
                                on:click={header.column.getToggleSortingHandler()}
                                class:cursor-default={!header.column.getCanSort()}
                                class:cursor-pointer={header.column.getCanSort()}
                                disabled={!header.column.getCanSort()}
                            >
                                <svelte:component
                                    this={flexRender(
                                        header.column.columnDef.header,
                                        header.getContext(),
                                    )}
                                />
                                {#if header.column.getCanSort()}
                                    <span class="opacity-50 min-w-[12px]">
                                        {{ asc: "▲", desc: "▼" }[
                                            header.column.getIsSorted()
                                        ] || "⇅"}
                                    </span>
                                {/if}
                            </button>
                        {/if}
                    </th>
                {/each}
            </tr>
        {/each}
    </thead>
    <tbody>
        {#each $table.getRowModel().rows as row}
            <tr class={rowClass}>
                {#each row.getVisibleCells() as cell}
                    <td class="px-4 py-2">
                        <svelte:component
                            this={flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                            )}
                        />
                    </td>
                {/each}
            </tr>
        {:else}
            <tr>
                <td
                    colspan={columns.length}
                    class="p-4 text-center opacity-50 italic"
                >
                    {emptyMessage}
                </td>
            </tr>
        {/each}
    </tbody>
</table>

<style>
    button {
        background: none;
        border: none;
        padding: 0;
        color: inherit;
        text-align: inherit;
    }
</style>
