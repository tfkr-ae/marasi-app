<script>
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";

    export let extensionData;
    export let value = { bind: "" };
    export let options = [];
    export let classes = "select select-bordered w-full p-2";
    export let disabled = false;
    export let multiple = false;
    export let size = 1;

    $: effectiveValue = resolveBind($extensions_ui, extensionData, value);

    function handleChange(event) {
        const node = event.target;
        let val;

        if (multiple) {
            val = Array.from(node.selectedOptions).map((opt) => opt.value);
        } else {
            val = node.value;
        }

        updateBind(extensionData, value, val);
    }
</script>

<select
    {disabled}
    {multiple}
    {size}
    class={classes}
    value={effectiveValue}
    on:change={handleChange}
>
    {#each options as option}
        {@const optValue = typeof option === "object" ? option.value : option}
        {@const optLabel =
            typeof option === "object" ? option.label || option.value : option}

        <option value={optValue}>
            {optLabel}
        </option>
    {/each}
</select>
