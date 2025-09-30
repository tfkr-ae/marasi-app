<script>
    import CodeMirror from "svelte-codemirror-editor";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { vim } from "@replit/codemirror-vim";
    import { StreamLanguage } from "@codemirror/language";
    import { http } from "@codemirror/legacy-modes/mode/http";
    import { Braces, CodeIcon, CopyIcon, Maximize, Pen, WrapTextIcon } from "lucide-svelte";
    import { drawerHeight, marasiConfig, prettify, lineWrap} from "../../stores";
    import { GetNote } from "../wailsjs/go/main/App";
    import { getModalStore, getDrawerStore } from "@skeletonlabs/skeleton";
    import { onMount } from "svelte";

    const modalStore = getModalStore();
    const drawerStore = getDrawerStore();
    export let request;
    export let response;
    export let metadata = {};
    export let requestTitle = "Request & Response";
    export let requestBody;
    export let responseBody;
    export let showPrettify = true;
    export let showToggle = false;
    export let requestReadOnly = true;
    export let responseReadOnly = true;
    let userEdited = false;

    let requestEditor, responseEditor;

    // Initial setup - happens once during component creation
    onMount(() => {
        if ($prettify) {
            requestBody = metadata["prettified-request"] ? metadata["prettified-request"] : request.Raw;
            responseBody = metadata["prettified-response"] ? metadata["prettified-response"] : response.Raw;
        } else {
            requestBody = request.Raw;
            responseBody = response.Raw;
        }
    });

    $: setTimeout(adjustHeights, 50);
    $: if (requestBody) {
        setTimeout(adjustHeights, 50);
    }

    function getLang(body) {
      // Check value of store
      switch($marasiConfig.SyntaxMode) {
        case "disabled":
          return undefined;
        break;
        case "auto":
          // Check length
          if (body.length < 75000) return StreamLanguage.define(http)
          return undefined;
        break;
        case "enabled":
          return StreamLanguage.define(http)
        break;
      }
    }
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

    function copyRequest() {
        navigator.clipboard.writeText(requestBody);
    }

    function copyResponse() {
        navigator.clipboard.writeText(responseBody);
    }

    function viewNote() {
        GetNote(request.ID.toString()).then(
            (note) => {
                const modal = {
                    type: "component",
                    component: "Notes",
                    title: requestTitle + " notes",
                    requestID: request.ID,
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
            content: metadata,
            title: requestTitle + " Metadata",
        };
        if (!$modalStore[0]) {
            modalStore.trigger(modal);
        }
    }

    function togglePrettify() {
        if (userEdited) {
            // Show confirmation dialog
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

    // Safe way to handle null/undefined metadata
    function safeCompare(editorText, originalText) {
        if (typeof originalText !== 'string') return false;
        return editorText === originalText.replaceAll("\r\n", "\n");
    }

    $: {
        if (!userEdited) {
            if ($prettify) {
                requestBody = metadata["prettified-request"] ? metadata["prettified-request"] : request.Raw;
                responseBody = metadata["prettified-response"] ? metadata["prettified-response"] : response.Raw;
            } else {
                requestBody = request.Raw;
                responseBody = response.Raw;
            }
        } else {
            console.log("wait");
        }
    }
</script>

<div class="flex p-2 justify-between items-center w-full sticky top-0 z-50 bg-inherit">
    <!-- Left: Request number -->
    <div class="flex items-center space-x-2 flex-shrink-0">
        {#if showToggle}
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
        <h5 class="h5 flex-shrink-0">{requestTitle}</h5>
    </div>

    <!-- Center: Button bar for actions -->
    <div class="flex space-x-2 flex-grow justify-center">
        <button class="btn btn-sm variant-soft-primary flex items-center" on:click={copyRequest}>
            <CopyIcon size={14} class="mr-1" /> Copy Request
        </button>
        <button class="btn btn-sm variant-soft-primary flex items-center" on:click={copyResponse}>
            <CopyIcon size={14} class="mr-1" /> Copy Response
        </button>
        <button class="btn btn-sm variant-soft-secondary flex items-center" on:click={viewNote}>
            <Pen size={14} class="mr-1" /> View Note
        </button>
        <button class="btn btn-sm variant-soft-secondary flex items-center" on:click={viewMetadata}>
            <Braces size={14} class="mr-1" /> View Metadata
        </button>
    </div>

    <!-- Right: Prettify toggle -->
    <div class="flex justify-right space-x-2">
        {#if showPrettify}
        <div class="flex items-center space-x-2 flex-shrink-0">
            <span class="text-sm">Prettify</span>
            <button
                class="p-1 rounded {$prettify ? 'bg-warning-500 text-slate-500' : 'bg-warning-50 text-slate-500'}"
                on:click={togglePrettify}
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

<div class="flex flex-col sm:flex-row w-full">
    <div class="flex-1 p-1 overflow-auto">
        <CodeMirror
            on:change={(event) => {
                const text = event.detail;
                if (!safeCompare(text, metadata["prettified-request"]) &&
                    !safeCompare(text, request.Raw)) {
                    userEdited = true;
                } else {
                    userEdited = false;
                }
            }}
            bind:this={requestEditor}
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
            bind:this={responseEditor}
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
