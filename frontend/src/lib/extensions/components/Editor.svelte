<script>
    import { tick } from "svelte";
    import CodeMirror from "svelte-codemirror-editor";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { vim } from "@replit/codemirror-vim";
    import { extensions_ui, marasiConfig } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";
    import { StreamLanguage } from "@codemirror/language";
    import { javascript } from "@codemirror/lang-javascript";
    import { http } from "@codemirror/legacy-modes/mode/http";

    export let extensionData;
    export let value = { bind: "" };
    export let readonly = false;
    export let placeholder = "Enter code...";
    export let classes = "";
    export let lang = "http";
    export let styles = {
        width: "100%",
        "max-width": "100%",
        height: "5rem",
        "min-height": "100px",
    };

    let timer;
    const DEBOUNCE_MS = 50;
    let isTyping = false;

    $: effectiveValue = resolveBind($extensions_ui, extensionData, value) ?? "";

    let localValue = effectiveValue;

    $: if (!isTyping && effectiveValue !== localValue) {
        localValue = effectiveValue;
    }

    $: language = (() => {
        if (lang === "javascript") return StreamLanguage.define(javascript);
        return StreamLanguage.define(http);
    })();

    async function handleChange(event) {
        isTyping = true;
        localValue = event.detail;

        clearTimeout(timer);
        timer = setTimeout(async () => {
            updateBind(extensionData, value, localValue);
            await tick();
            isTyping = false;
        }, DEBOUNCE_MS);
    }
</script>

<CodeMirror
    value={localValue}
    class={"text-xs " + classes}
    theme={oneDark}
    extensions={$marasiConfig?.VimEnabled ? [vim()] : []}
    lang={language}
    {readonly}
    {placeholder}
    styles={{
        "&": styles,
    }}
    on:change={handleChange}
/>
