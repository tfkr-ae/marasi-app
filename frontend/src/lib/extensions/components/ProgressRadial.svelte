<script>
    import { ProgressRadial } from "@skeletonlabs/skeleton";
    import { extensions_ui } from "../../../stores";
    import { resolveBind } from "./utils";

    export let extensionData;
    export let width = "w-24";
    export let value = true;
    export let font = 10;
    export let stroke = 30;
    const meter = "stroke-primary-500";

    $: isVisible = resolveBind($extensions_ui, extensionData, value);
</script>

{#if isVisible}
    <ProgressRadial {width} {meter} {font} {stroke} value={undefined} />
{/if}
