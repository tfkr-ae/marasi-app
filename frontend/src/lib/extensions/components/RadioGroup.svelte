<script>
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";

    export let extensionData;
    export let value = "";
    export let choiceValue = "";
    export let name = "";
    export let classes = "radio radio-primary";
    export let disabled = false;

    $: groupValue = resolveBind($extensions_ui, extensionData, value);
    $: isChecked = groupValue === choiceValue;

    function handleChange() {
        updateBind(extensionData, value, choiceValue);
    }
</script>

<input
    type="radio"
    {name}
    {disabled}
    value={choiceValue}
    checked={isChecked}
    on:change={handleChange}
    class={classes}
/>
