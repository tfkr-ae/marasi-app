<script>
    import { tick } from "svelte";
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";

    export let extensionData;
    export let value = { bind: "" };
    export let placeholder = "";
    export let classes =
        "textarea textarea-bordered w-full p-2 focus:outline-none focus:ring-2 focus:ring-primary-500";
    export let disabled = false;
    export let readonly = false;
    export let rows = 5;
    export let cols = 10;

    const DEBOUNCE_MS = 300;

    let timer;
    let isTyping = false;

    $: effectiveValue = resolveBind($extensions_ui, extensionData, value) ?? "";

    let localValue = effectiveValue;

    $: if (!isTyping && effectiveValue !== localValue) {
        localValue = effectiveValue;
    }

    async function handleInput(e) {
        isTyping = true;
        localValue = e.target.value;

        clearTimeout(timer);
        timer = setTimeout(async () => {
            updateBind(extensionData, value, localValue);

            await tick();
            isTyping = false;
        }, DEBOUNCE_MS);
    }
</script>

<textarea
    {placeholder}
    {disabled}
    {readonly}
    {rows}
    {cols}
    class={classes}
    value={localValue}
    on:input={handleInput}
/>
