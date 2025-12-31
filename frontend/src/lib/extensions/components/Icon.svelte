<script>
    import DOMPurify from "dompurify";
    import * as Icons from "lucide-svelte";

    export let svg;
    export let icon;
    export let size = 24;
    export let classes = "";

    $: safeSvg = svg
        ? DOMPurify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
          })
        : "";

    $: IconComponent = icon ? Icons[icon] : null;
</script>

<div
    class="icon-wrapper inline-flex items-center justify-center {classes}"
    style="width: {size}px; height: {size}px;"
>
    {#if IconComponent}
        <svelte:component this={IconComponent} {size} />
    {:else if safeSvg}
        {@html safeSvg}
    {:else}
        <span class="text-xs">?</span>
    {/if}
</div>

<style>
    .icon-wrapper :global(svg) {
        width: 100%;
        height: 100%;
        display: block;
    }
</style>
