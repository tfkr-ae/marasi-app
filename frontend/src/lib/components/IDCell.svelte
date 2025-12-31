<script>
    import {
        SendIcon,
        FlagIcon,
        EditIcon,
        Edit2Icon,
        Replace,
    } from "lucide-svelte";

    export let index;
    export let row;

    $: activeIcons = [
        { show: row.Metadata?.launchpad, component: SendIcon },
        { show: row.Metadata?.intercepted, component: FlagIcon },
        {
            show:
                row.Metadata?.intercepted &&
                row.Metadata["original-request"] !== row.Raw,
            component: EditIcon,
        },
        {
            show:
                row.Metadata?.intercepted &&
                row.Metadata["original-response"] !== row.Raw,
            component: EditIcon,
        },
        { show: row.Metadata?.has_note == 1, component: Edit2Icon },
        { show: row.Metadata?.override_host, component: Replace },
    ].filter((i) => i.show);
</script>

<div class="flex flex-row items-center">
    <span class="min-w-[1rem] inline-block text-right font-mono mr-3">
        {index}
    </span>

    {#if activeIcons.length > 0}
        <div class="flex flex-row gap-1">
            {#each activeIcons as icon}
                <svelte:component this={icon.component} size="14" />
            {/each}
        </div>
    {:else}
        <div class="flex flex-row gap-1 items-center justify-center w-[14px]">
            <div class="w-1 h-1 rounded-full bg-surface-400/20"></div>
        </div>
    {/if}
</div>
