<script>
    import { onMount } from "svelte";
    import CodeMirror from "svelte-codemirror-editor";
    import {
        GetMetadata,
        GetNote,
        GetRawDetails,
    } from "../wailsjs/go/main/App";
    import {
        Braces,
        CodeIcon,
        CopyIcon,
        EyeOffIcon,
        Maximize,
        Pen,
        WrapTextIcon,
    } from "lucide-svelte";
    import {
        drawerHeight,
        marasiConfig,
        prettify,
        lineWrap,
    } from "../../stores";
    import { getModalStore, getDrawerStore } from "@skeletonlabs/skeleton";
    import { vim } from "@replit/codemirror-vim";
    import { StreamLanguage } from "@codemirror/language";
    import { http } from "@codemirror/legacy-modes/mode/http";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { modeCurrent } from "@skeletonlabs/skeleton";
    import { ayuLight } from "thememirror";
    import { beforeNavigate, goto } from "$app/navigation";

    const modalStore = getModalStore();
    const drawerStore = getDrawerStore();
    export let request_id;
    export let titleText = "";
    export let showTitleBar = true;
    export let showSizeToggle = false;
    export let showPrettifyToggle = true;
    export let requestReadOnly = true;
    export let responseReadOnly = true;
    export let isFiltered = false;
    export let incomingResponse = undefined;
    export let requestBody;

    let responseBody = "";
    let selectedRow;

    let userEdited = false;
    function adjustHeights() {
        const editors = document.querySelectorAll(".cm-editor");

        editors.forEach((editor) => {
            editor.style.height = "auto";
        });

        void editors[0]?.offsetHeight;

        let maxHeight = 0;

        editors.forEach((editor) => {
            const height = editor.scrollHeight;
            if (height > maxHeight) {
                maxHeight = height;
            }
        });

        maxHeight = Math.max(maxHeight, 200);

        editors.forEach((editor) => {
            editor.style.height = `${maxHeight}px`;
        });
    }

    function getLang(body) {
        if (!body) return undefined;

        switch ($marasiConfig.SyntaxMode) {
            case "disabled":
                return undefined;
            case "auto":
                if (body.length < 75000) return StreamLanguage.define(http);
                return undefined;
            case "enabled":
                return StreamLanguage.define(http);
        }
    }

    function viewNote() {
        GetNote(request_id.toString()).then((note) => {
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
        });
    }

    function viewMetadata() {
        GetMetadata(request_id).then((metadata) => {
            const modal = {
                type: "component",
                component: "Metadata",
                content: metadata,
                title: titleText + " Metadata",
            };
            if (!$modalStore[0]) {
                modalStore.trigger(modal);
            }
        });
    }

    function togglePrettify() {
        if (requestReadOnly && responseReadOnly) {
            prettify.update((value) => !value);
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
                            prettify.update((value) => !value);
                            userEdited = false;
                            setTimeout(adjustHeights, 50);
                        }
                    },
                };
                modalStore.trigger(modal);
            } else {
                // No edits, toggle directly
                prettify.update((value) => !value);
                setTimeout(adjustHeights, 50);
            }
        }
    }
    function safeCompare(editorText, originalText) {
        if (typeof originalText !== "string") return false;
        return editorText === originalText.replaceAll("\r\n", "\n");
    }

    $: {
        const currentRequestId = request_id;
        GetRawDetails(request_id).then((row) => {
            if (currentRequestId !== request_id) return;
            selectedRow = row;
            if ($prettify) {
                requestBody =
                    row?.Metadata?.["prettified-request"] ??
                    row?.Request?.Raw ??
                    "";
                responseBody =
                    row?.Metadata?.["prettified-response"] ??
                    row?.Response?.Raw ??
                    "";
            } else {
                requestBody = row?.Request?.Raw ?? "";
                responseBody = row?.Response?.Raw ?? "";
            }
            setTimeout(adjustHeights, 50);
        });
    }
    beforeNavigate(({ to, cancel }) => {
        if (requestReadOnly && responseReadOnly) return;
        if (userEdited) {
            cancel();
            const modal = {
                type: "confirm",
                title: "Confirm Action",
                body: "You have made changes to the text. Navigating away will clear your changes. Continue?",
                response: (result) => {
                    if (result) {
                        userEdited = false;
                        goto(to?.route?.id);
                    } else {
                        cancel();
                    }
                },
            };
            modalStore.trigger(modal);
        } else return;
    });
    onMount(() => {
        GetRawDetails(request_id).then((row) => {
            selectedRow = row;
            if ($prettify) {
                requestBody =
                    row?.Metadata?.["prettified-request"] ??
                    row?.Request?.Raw ??
                    "";
                responseBody =
                    row?.Metadata?.["prettified-response"] ??
                    row?.Response?.Raw ??
                    "";
            } else {
                requestBody = row?.Request?.Raw ?? "";
                responseBody = row?.Response?.Raw ?? "";
            }
            setTimeout(adjustHeights, 50);
        });
    });

    $: {
        if (selectedRow) {
            if (requestReadOnly && responseReadOnly) {
                if ($prettify) {
                    requestBody =
                        selectedRow?.Metadata?.["prettified-request"] ??
                        selectedRow?.Request?.Raw ??
                        "";
                    responseBody =
                        selectedRow?.Metadata?.["prettified-response"] ??
                        selectedRow?.Response?.Raw ??
                        "";
                } else {
                    requestBody = selectedRow?.Request?.Raw ?? "";
                    responseBody = selectedRow?.Response?.Raw ?? "";
                }
            } else {
                if (!userEdited) {
                    if ($prettify) {
                        requestBody =
                            selectedRow?.Metadata?.["prettified-request"] ??
                            requestBody;

                        responseBody =
                            selectedRow?.Metadata?.["prettified-response"] ??
                            selectedRow?.Response?.Raw ??
                            "";
                    } else {
                        responseBody = selectedRow?.Response?.Raw ?? "";
                    }
                }
            }
            setTimeout(adjustHeights, 50);
        }
    }
    $: if (incomingResponse !== undefined && selectedRow) {
        if (!selectedRow.Response) selectedRow.Response = {};
        selectedRow.Response = incomingResponse;

        selectedRow = selectedRow;
    }
</script>

{#if showTitleBar}
    <div
        class="flex p-2 justify-between items-center w-full sticky top-0 z-50 bg-inherit"
    >
        <div class="flex items-center space-x-2 flex-shrink-0">
            {#if showSizeToggle}
                <button
                    class="p-1 rounded {$drawerHeight === 'h-[100%]'
                        ? 'bg-warning-500 text-slate-500'
                        : 'bg-warning-50 text-slate-500'}"
                    on:click={() => {
                        if ($drawerStore.open) {
                            if ($drawerHeight === "h-[60%]") {
                                $drawerHeight = "h-[100%]";
                                $drawerStore.height = $drawerHeight;
                            } else {
                                $drawerHeight = "h-[60%]";
                                $drawerStore.height = $drawerHeight;
                            }
                        }
                    }}
                >
                    <Maximize size={16} />
                </button>
            {/if}
            <h5 class="h5 flex-shrink-0">
                {titleText}
                {#if isFiltered}
                    <span
                        class="justify-center inline-flex items-center gap-1.5 ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200"
                    >
                        <EyeOffIcon size={14} strokeWidth={2.5} />
                        Filtered
                    </span>
                {/if}
            </h5>
        </div>
        <div class="flex space-x-2 flex-grow px-2">
            <button
                class="btn btn-sm variant-soft-primary flex items-center"
                on:click={() => {
                    navigator.clipboard.writeText(requestBody);
                }}
            >
                <CopyIcon size={14} class="mr-1" /> Copy Request
            </button>
            <button
                class="btn btn-sm variant-soft-primary flex items-center"
                on:click={() => {
                    navigator.clipboard.writeText(responseBody);
                }}
            >
                <CopyIcon size={14} class="mr-1" /> Copy Response
            </button>
            <button
                class="btn btn-sm variant-soft-secondary flex items-center"
                on:click={() => {
                    viewNote();
                }}
            >
                <Pen size={14} class="mr-1" /> View Note
            </button>
            <button
                class="btn btn-sm variant-soft-secondary flex items-center"
                on:click={() => {
                    viewMetadata();
                }}
            >
                <Braces size={14} class="mr-1" /> View Metadata
            </button>
        </div>
        <div class="flex justify-right space-x-2">
            {#if showPrettifyToggle}
                <div class="flex items-center space-x-2 flex-shrink-0">
                    <span class="text-sm">Prettify</span>
                    <button
                        class="p-1 rounded {$prettify
                            ? 'bg-warning-500 text-slate-500'
                            : 'bg-warning-50 text-slate-500'}"
                        on:click={() => {
                            togglePrettify();
                        }}
                    >
                        <CodeIcon size={16} />
                    </button>
                </div>
            {/if}
            <div class="flex items-center space-x-2 flex-shrink-0">
                <span class="text-sm">Linewrap</span>
                <button
                    class="p-1 rounded {$lineWrap
                        ? 'bg-warning-500 text-slate-500'
                        : 'bg-warning-50 text-slate-500'}"
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

{#if requestBody || responseBody}
    <div class="flex flex-col sm:flex-row w-full">
        <div class="flex-1 p-1 overflow-auto">
            <CodeMirror
                on:change={(event) => {
                    const text = event.detail;
                    if (
                        !safeCompare(
                            text,
                            selectedRow?.Metadata["prettified-request"],
                        ) &&
                        !safeCompare(text, selectedRow?.Request?.Raw ?? "")
                    ) {
                        userEdited = true;
                    } else {
                        userEdited = false;
                    }
                }}
                class="text-xs"
                bind:value={requestBody}
                lang={getLang(requestBody)}
                theme={$modeCurrent ? ayuLight : oneDark}
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
                theme={$modeCurrent ? ayuLight : oneDark}
                extensions={$marasiConfig.VimEnabled ? [vim()] : []}
                readonly={responseReadOnly}
                lineWrapping={$lineWrap}
            ></CodeMirror>
        </div>
    </div>
{/if}
