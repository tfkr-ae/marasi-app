<script>
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";

    export let extensionData;
    export let value = false;
    export let classes = "checkbox checkbox-primary";
    export let disabled = false;

    $: isChecked = resolveBind($extensions_ui, extensionData, value);

    function handleChange(event) {
        updateBind(extensionData, value, event.target.checked);
    }
</script>

<input
    type="checkbox"
    {disabled}
    class={classes}
    checked={!!isChecked}
    on:change={handleChange}
/>
