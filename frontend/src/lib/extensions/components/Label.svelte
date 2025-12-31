<script>
    import { extensions_ui } from "../../../stores";
    import { resolveBind } from "./utils";
    export let extensionData;
    export let value = "";
    export let classes = "text-sm font-medium opacity-70 ml-1";

    $: localValue = resolveBind($extensions_ui, extensionData, value);
</script>

<label class={classes}>{localValue}</label>
