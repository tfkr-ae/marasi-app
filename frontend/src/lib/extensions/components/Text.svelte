<script>
    import { extensions_ui } from "../../../stores";
    import { resolveBind } from "./utils";

    export let extensionData;
    export let value = { bind: "" };
    export let tag = "p";
    export let classes = "";

    const allowedTags = [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "span",
        "strong",
        "em",
        "small",
        "code",
        "pre",
        "blockquote",
        "label",
    ];

    $: displayValue = resolveBind($extensions_ui, extensionData, value) ?? "";

    $: safeTag = allowedTags.includes(tag) ? tag : "p";
</script>

<svelte:element this={safeTag} class={classes}>
    {displayValue}
</svelte:element>
