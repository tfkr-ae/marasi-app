<script>
    import { tick } from "svelte";
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";
    const DEBOUNCE_MS = 250;

    export let extensionData;
    export let value = { bind: "" };
    export let label = "";
    export let placeholder = "";
    export let validation = {};
    export let classes = "flex flex-col w-full";
    export let disabled = false;

    let timer;
    let errorMessage = "";
    let isTyping = false;

    $: effectiveValue = resolveBind($extensions_ui, extensionData, value) ?? "";
    let localValue = effectiveValue;

    $: if (!isTyping && effectiveValue !== localValue) {
        localValue = effectiveValue;
    }

    async function handleInput(e) {
        const node = e.target;
        isTyping = true;
        localValue = node.value;

        errorMessage = !node.checkValidity()
            ? validation.customError || node.validationMessage
            : "";

        clearTimeout(timer);
        timer = setTimeout(async () => {
            const val =
                validation.type === "number"
                    ? localValue === ""
                        ? null
                        : parseFloat(localValue)
                    : localValue;

            updateBind(extensionData, value, val);

            await tick();
            isTyping = false;
        }, DEBOUNCE_MS);
    }
</script>

<div class={classes}>
    {#if label}
        <span class="label-text mb-1 ml-1 text-sm font-medium opacity-80">
            {label}
        </span>
    {/if}

    <input
        {placeholder}
        {disabled}
        class="input w-full {errorMessage ? 'input-error' : ''}"
        value={localValue}
        on:input={handleInput}
        {...validation}
    />

    {#if errorMessage}
        <span class="text-red-500 text-xs mt-1 transition-all">
            {errorMessage}
        </span>
    {/if}
</div>
