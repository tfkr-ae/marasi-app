<script>
    import CodeMirror from "svelte-codemirror-editor";
    import { StreamLanguage } from "@codemirror/language";
    import { http } from "@codemirror/legacy-modes/mode/http";
    import { lua } from "@codemirror/legacy-modes/mode/lua";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { vim } from "@replit/codemirror-vim";
    import {
        GetIntercepted,
        GetInterceptedQueue,
        CheckHTTPParse,
        ForwardIntercepted,
        DropIntercepted,
        RunExtension,
        ToggleIntercept,
        InterceptResponse,
    } from "../../lib/wailsjs/go/main/App";
    import { onMount } from "svelte";
    import { EventsOn } from "../../lib/wailsjs/runtime/runtime";
    import {
        Accordion,
        AccordionItem,
        getDrawerStore,
        getToastStore,
    } from "@skeletonlabs/skeleton";
    import { SettingsIcon } from "svelte-feather-icons";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        CornerLeftDown,
        EditIcon,
        FileCode,
        FilePenLine,
        Forward,
        SquarePlay,
        ToggleLeft,
    } from "lucide-svelte";
    import { checkpointCode, marasiConfig, interceptFlag, lineWrap} from "../../stores";
    const toastStore = getToastStore();
    const drawerStore = getDrawerStore();

    let intercepted = "";
    let type = "";
    let error = "";
    let accOpened;
    const checkpointMenu = [
        {
            name: "Toggle Checkpoint Settings",
            subtitle: "Toggle Settings Accordian",
            icon: ToggleLeft,
            keywords: "settings, toggle",
            action: {
                handler: () => {
                    accOpened = !accOpened;
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        {
            name: "Edit Checkpoint",
            subtitle: "Jump to code editor",
            keywords: "edit, toggle",
            icon: EditIcon,
            action: {
                handler: () => {
                    if (!accOpened) {
                        accOpened = true;
                    }
                    setTimeout(() => {
                        const cmContent = document.querySelector(
                            'div[data-language="lua"]',
                        );
                        cmContent.focus();
                    }, 300);
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+⇧+E", "ctrl+⇧+E"],
            },
        },
        {
            name: "Update Checkpoint Code",
            subtitle: "Execute Checkpoint code",
            keywords: "edit, toggle",
            icon: SquarePlay,
            action: {
                handler: () => {
                    RunExtension("checkpoint", $checkpointCode)
                        .then(() => {
                            const toastSettings = {
                                message: "Updated checkpoint rules",
                                background: "variant-filled-success",
                            };
                            toastStore.trigger(toastSettings);
                        })
                        .catch((error) => {
                            console.log("Error");
                            const toastSettings = {
                                message: "Error updating rules",
                                background: "variant-filled-error",
                            };
                            toastStore.trigger(toastSettings);
                        });
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+⇧+R", "ctrl+⇧+R"],
            },
        },
        {
            name: "Edit Intercepted Item",
            subtitle: "Jump to intercepted item editor",
            keywords: "intercept, toggle",
            icon: FilePenLine,
            action: {
                handler: () => {
                    if (interceptedCount > 0) {
                        const cmContent = document.querySelector(
                            'div[data-language="javascript"]',
                        );
                        cmContent.focus();
                    }
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+⇧+I", "ctrl+⇧+I"],
            },
        },
        {
            name: "Forward Intercepted Item",
            subtitle: "Forward current item",
            keywords: "forward, toggle",
            icon: Forward,
            action: {
                handler: () => {
                    if (interceptedCount > 0) {
                        forward(intercepted);
                    }
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+⇧+F", "ctrl+⇧+F"],
            },
        },
        {
            name: "Drop Intercepted Item",
            subtitle: "Drop current item",
            keywords: "drop, toggle",
            icon: CornerLeftDown,
            action: {
                handler: () => {
                    if (interceptedCount > 0) {
                        drop();
                    }
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+⇧+D", "ctrl+⇧+D"],
            },
        },
        {
            name: "Show Logs",
            subtitle: "Show Extension Logs",
            keywords: "logs, lua",
            icon: FileCode,
            action: {
                handler: () => {
                    if ($drawerStore.open) {
                        drawerStore.close();
                    } else {
                        const drawerSettings = {
                            id: "extension-logs",
                            meta: {
                                extensionName: "checkpoint",
                            },
                            height: "h-full",
                            width: "w-3/5",
                            position: "right",
                        };
                        drawerStore.open(drawerSettings);
                    }
                },
                options: { scope: "checkpoint", single: true },
                keys: ["⌘+⇧+L", "ctrl+⇧+L"],
            },
        },
    ];
    $: {
        CheckSyntax(intercepted);
    }
    let interceptedCount = 0;
    function CheckSyntax(text) {
        CheckHTTPParse(text).then((response) => {
            error = response;
        });
    }
    function forwardAndInterceptResponse() {
        InterceptResponse().then(() => {
            GetNext();
        });
    }
    function drop() {
        DropIntercepted().then(() => {
            GetNext();
        });
    }
    function forward(body) {
        ForwardIntercepted(body).then(() => {
            GetNext();
        });
    }
    function GetNext() {
        GetIntercepted().then((result) => {
            intercepted = result.raw ? result.raw : "No item in queue";
            type = result.type ? result.type : "";
        });
        GetInterceptedQueue().then((count) => {
            interceptedCount = count;
        });
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
    onMount(() => {
        EventsOn("intercepted", () => GetNext());
        GetNext();
        GetInterceptedQueue().then((count) => {
            interceptedCount = count;
        });
        /*
        GetInterceptFlag().then((flag) => {
            $interceptFlag.set(flag);
        });
        */
        return () => {
            //intercepted = "";
            //EventsOff("intercepted");
        };
    });
</script>

<MarasiKeys scope="checkpoint" menuOptions={checkpointMenu} />
<Accordion rounded="false">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Checkpoint Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <CodeMirror
                bind:value={$checkpointCode}
                class="text-xs"
                theme={oneDark}
                extensions={$marasiConfig.VimEnabled
                    ? [vim(), StreamLanguage.define(lua)]
                    : [StreamLanguage.define(lua)]}
            />
            <div class="flex justify-end mt-2">
                <button
                    type="button"
                    class="btn variant-filled-primary"
                    on:click={() => {
                        RunExtension("checkpoint", $checkpointCode)
                            .then(() => {
                                const toastSettings = {
                                    message: "Updated checkpoint rules",
                                    background: "variant-filled-success",
                                };
                                toastStore.trigger(toastSettings);
                            })
                            .catch((error) => {
                                console.log("Error");
                                const toastSettings = {
                                    message: "Error updating rules",
                                    background: "variant-filled-error",
                                };
                                toastStore.trigger(toastSettings);
                            });
                    }}>Update Intercept Rules</button
                >
            </div>
        </svelte:fragment>
    </AccordionItem>
    <!-- ... -->
</Accordion>
<div class="p-1 flex flex-col items-center">
    <div class="btn-group variant-filled-primary">
        <button
            disabled={error !== ""}
            on:click={() => {
                forward(intercepted);
            }}>Forward</button
        >
        <button
            disabled={type !== "request"}
            on:click={() => {
                forwardAndInterceptResponse();
            }}>Intercept Response</button
        >
        <button
            class={$interceptFlag
                ? "btn variant-filled-success hover:variant-filled-success"
                : "btn variant-filled-primary"}
            on:click={() => {
                ToggleIntercept().then((flag) => {
                    interceptFlag.set(flag);
                });
            }}
            >{$interceptFlag
                ? "Global Intercept (On)"
                : "Global Intercept (Off)"}</button
        >
        <button
            on:click={() => {
                drop();
            }}>Drop</button
        >
        <!--<button disabled="true">Intercept Response</button>-->
    </div>
    <div class="text-center">
        {#if interceptedCount > 0}
            <p>Intercept Queue: {interceptedCount}</p>
        {:else}
            <p>No items in interception queue</p>
        {/if}
    </div>
    <div class="text-center">
        {#if error === ""}
            <p>No Error</p>
        {:else}
            <p>{error}</p>
        {/if}
    </div>
    <div class='w-full filler-color flex justify-center'>
        <div class="w-[50%]">
        <CodeMirror
            bind:value={intercepted}
            lang={getLang(intercepted)}
            class="text-xs"
            theme={oneDark}
            extensions={$marasiConfig.VimEnabled ? [vim()] : []}
            lineWrapping={$lineWrap}
        />
        </div>
    </div>
</div>
<style>
    .filler-color {
        background-color: #282c34
    }
</style>