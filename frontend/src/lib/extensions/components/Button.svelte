<script>
    import { getContext } from "svelte";
    import * as Icons from "lucide-svelte";
    import { EventsEmit } from "../../../lib/wailsjs/runtime/runtime";
    import { extensions_ui } from "../../../stores";
    import { resolveBind } from "./utils";

    const inGroup = getContext("ButtonGroup");
    export let extensionData;
    export let value;
    export let classes = "";
    export let icon;
    export let on_click;

    $: finalClasses = inGroup
        ? ""
        : classes && classes !== ""
          ? classes
          : "btn variant-filled-primary";
    $: IconComponent = icon ? Icons[icon?.name] : null;

    $: displayValue = resolveBind($extensions_ui, extensionData, value);

    function handleClick() {
        if (on_click) {
            EventsEmit("extension_call_function", {
                extensionID: extensionData.ID,
                function: on_click,
                state: $extensions_ui[extensionData.Name],
            });
        }
    }
</script>

<button on:click={handleClick} class={finalClasses} type="button">
    {#if IconComponent}
        <span><svelte:component this={IconComponent} size={icon?.size} /></span>
    {/if}

    {#if displayValue}
        <span>{displayValue}</span>
    {/if}
</button>
