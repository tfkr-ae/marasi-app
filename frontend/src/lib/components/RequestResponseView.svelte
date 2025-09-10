<script>
    import { onMount } from "svelte";
    import CodeMirror from "svelte-codemirror-editor";
    import { GetNote, GetRawDetails } from "../wailsjs/go/main/App";
    import { Braces, CodeIcon, CopyIcon, Maximize, Pen, WrapTextIcon } from "lucide-svelte";
    import { drawerHeight, marasiConfig, prettify, lineWrap} from "../../stores";
    import { getModalStore, getDrawerStore } from "@skeletonlabs/skeleton";
    import { vim } from "@replit/codemirror-vim";
    import { StreamLanguage } from "@codemirror/language";
    import { http } from "@codemirror/legacy-modes/mode/http";
    import { oneDark } from "@codemirror/theme-one-dark";

    const modalStore = getModalStore();
    const drawerStore = getDrawerStore();
    export let request_id;
    export let titleText = ""
    export let showTitleBar = true;
    export let showSizeToggle = false;
    export let showPrettifyToggle = true;
    export let requestReadOnly = true;
    export let responseReadOnly = true;
    // Request body is exported for launchpad
    export let requestBody

    let responseBody, selectedRow;

    let userEdited = false;
    function adjustHeights() {
        const editors = document.querySelectorAll(".cm-editor");

        // First, reset heights to auto to get true content height
        editors.forEach((editor) => {
            editor.style.height = 'auto';
        });

        // Force layout recalculation
        void editors[0]?.offsetHeight;

        let maxHeight = 0;

        // Now find the maximum content height
        editors.forEach((editor) => {
            // Use scrollHeight to get full content height
            const height = editor.scrollHeight;
            if (height > maxHeight) {
                maxHeight = height;
            }
        });

        // Set minimum height (can adjust as needed)
        maxHeight = Math.max(maxHeight, 200);


        // Now set all editors to the maximum height
        editors.forEach((editor) => {
            editor.style.height = `${maxHeight}px`;
        });
    }

    // Get lang based on body length and config
    function getLang(body) {
        switch($marasiConfig.SyntaxMode) {
            case "disabled":
            return undefined;
            case "auto":
            // Check length
            if (body.length < 75000) return StreamLanguage.define(http)
            return undefined;
            case "enabled":
            return StreamLanguage.define(http)
        }
    }

    function viewNote() {
        GetNote(request_id.toString()).then(
            (note) => {
                const modal = {
                    type: "component",
                    component: "Notes",
                    title: titleText + " notes",
                    requestID: request_id,
                    content: note,
                };
                if (!$modalStore[0]) {
                    modalStore.trigger(modal);
                }
            },
        );
    }

    function viewMetadata() {
        const modal = {
            type: "component",
            component: "Metadata",
            content: selectedRow?.Metadata,
            title: titleText + " Metadata",
        };
        if (!$modalStore[0]) {
            modalStore.trigger(modal);
        }
    }

    function togglePrettify() {
        // If the editors are readonly and it's safe to toggle
        if (requestReadOnly && responseReadOnly) {
            // No edits, toggle directly
            prettify.update(value => !value);
            setTimeout(adjustHeights, 50);
        } else {
            if (userEdited) {
                const modal = {
                    type: "confirm",
                    title: "Confirm Action",
                    body: "You have made changes to the text. Switching prettify mode will discard these changes. Continue?",
                    response: (result) => {
                        if (result) {
                            // User confirmed, proceed with toggle
                            prettify.update(value => !value);
                            userEdited = false;
                            setTimeout(adjustHeights, 50);
                        }
                    }
                };
                modalStore.trigger(modal);
            } else {
              // No edits, toggle directly
              prettify.update(value => !value);
              setTimeout(adjustHeights, 50);
            }
        }
    }
    function safeCompare(editorText, originalText) {
        if (typeof originalText !== 'string') return false;
        return editorText === originalText.replaceAll("\r\n", "\n");
    }


    onMount(() => {
        GetRawDetails(request_id).then((row) => {
            selectedRow = row;
            if ($prettify) {
                requestBody = row?.Metadata?.["prettified-request"] ?? (row?.Request?.Raw ?? '');
                responseBody = row?.Metadata?.["prettified-response"] ?? (row?.Response?.Raw ?? '');
            } else {
                requestBody = row?.Request?.Raw ?? '';
                responseBody = row?.Response?.Raw ?? '';
            }
            setTimeout(adjustHeights, 50);
        });
    });

    $: {
        // If the editors are readonly and it's safe to toggle
        if (requestReadOnly && responseReadOnly) {
            if ($prettify) {
                requestBody = selectedRow?.Metadata?.["prettified-request"] ?? (selectedRow?.Request?.Raw ?? '');
                responseBody = selectedRow?.Metadata?.["prettified-response"] ?? (selectedRow?.Response?.Raw ?? '');
            } else {
                requestBody = selectedRow?.Request?.Raw ?? '';
                responseBody = selectedRow?.Response?.Raw ?? '';
            }
        } else {
          if (!userEdited) {
            if ($prettify) {
                requestBody = selectedRow?.Metadata?.["prettified-request"] ?? (selectedRow?.Request?.Raw ?? '');
                responseBody = selectedRow?.Metadata?.["prettified-response"] ?? (selectedRow?.Response?.Raw ?? '');
            } else {
                requestBody = selectedRow?.Request?.Raw ?? '';
                responseBody = selectedRow?.Response?.Raw ?? '';
            }
          }
        }
        setTimeout(adjustHeights, 50);
    }
</script>

{#if showTitleBar}
    <div class="flex p-2 justify-between items-center w-full sticky top-0 z-50 bg-inherit">
        <div class="flex items-center space-x-2 flex-shrink-0">
            {#if showSizeToggle}
                <button
                    class="p-1 rounded {$drawerHeight === "h-[100%]" ? 'bg-warning-500 text-slate-500' : 'bg-warning-50 text-slate-500'}"
                    on:click={() => {
                        if ($drawerStore.open) {
                            if ($drawerHeight === "h-[60%]") {
                                $drawerHeight = "h-[100%]";
                                $drawerStore.height = $drawerHeight;
                            }
                            else {
                                $drawerHeight = "h-[60%]";
                                $drawerStore.height = $drawerHeight;
                            }
                        }
                    }}
                >
                    <Maximize size={16} />
                </button>
                {/if}
            <h5 class="h5 flex-shrink-0">{titleText}</h5>
        </div>
        <div class="flex space-x-2 flex-grow justify-center">
            <button class="btn btn-sm variant-soft-primary flex items-center" on:click={() => {
                navigator.clipboard.writeText(requestBody);
            }}>
                <CopyIcon size={14} class="mr-1" /> Copy Request
            </button>
            <button class="btn btn-sm variant-soft-primary flex items-center" on:click={() => {
                navigator.clipboard.writeText(responseBody);
            }}>
                <CopyIcon size={14} class="mr-1" /> Copy Response
            </button>
            <button class="btn btn-sm variant-soft-secondary flex items-center" on:click={() => {
                viewNote();
            }}>
                <Pen size={14} class="mr-1" /> View Note
            </button>
            <button class="btn btn-sm variant-soft-secondary flex items-center" on:click={() => {
                viewMetadata()
            }}>
                <Braces size={14} class="mr-1" /> View Metadata
            </button>
        </div>
        <div class="flex justify-right space-x-2">
            {#if showPrettifyToggle}
                <div class="flex items-center space-x-2 flex-shrink-0">
                    <span class="text-sm">Prettify</span>
                    <button
                        class="p-1 rounded {$prettify ? 'bg-warning-500 text-slate-500' : 'bg-warning-50 text-slate-500'}"
                        on:click={() => {togglePrettify()}}
                    >
                        <CodeIcon size={16} />
                    </button>
                </div>
                {/if}
            <div class="flex items-center space-x-2 flex-shrink-0">
                <span class="text-sm">Linewrap</span>
                <button
                    class="p-1 rounded {$lineWrap ? 'bg-warning-500 text-slate-500' : 'bg-warning-50 text-slate-500'}"
                    on:click={() => {
                        $lineWrap = $lineWrap ? false : true;
                        setTimeout(adjustHeights, 50);
                    }}
                >
                    <WrapTextIcon size={16} />
                </button>
            </div>
        </div>
    </div>
    {/if}

{#if requestBody && responseBody}
    <div class="flex flex-col sm:flex-row w-full">
        <div class="flex-1 p-1 overflow-auto">
            <CodeMirror
                on:change={(event) => {
                    const text = event.detail;
                    if (!safeCompare(text, selectedRow?.Metadata["prettified-request"]) &&
                        !safeCompare(text, selectedRow?.Request?.Raw ?? '')) {
                        userEdited = true;
                    } else {
                        userEdited = false;
                    }
                }}
                class="text-xs"
                bind:value={requestBody}
                lang={getLang(requestBody)}
                theme={oneDark}
                extensions={$marasiConfig.VimEnabled ? [vim()] : []}
                readonly={requestReadOnly}
                lineWrapping={$lineWrap}
            ></CodeMirror>
        </div>
        <div class="flex-1 p-1 overflow-auto">
            <CodeMirror
                class="text-xs"
                bind:value={responseBody}
                lang={getLang(responseBody)}
                theme={oneDark}
                extensions={$marasiConfig.VimEnabled ? [vim()] : []}
                readonly={responseReadOnly}
                lineWrapping={$lineWrap}
            ></CodeMirror>
        </div>
    </div>
    {/if}
