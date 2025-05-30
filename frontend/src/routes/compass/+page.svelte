<script>
    import { StreamLanguage } from "@codemirror/language";
    import { lua } from "@codemirror/legacy-modes/mode/lua";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { vim } from "@replit/codemirror-vim";
    import {
        Accordion,
        AccordionItem,
        getDrawerStore,
        getToastStore,
    } from "@skeletonlabs/skeleton";
    import { SettingsIcon } from "svelte-feather-icons";
    import CodeMirror from "svelte-codemirror-editor";
    import {
        RunExtension,
    } from "../../lib/wailsjs/go/main/App";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import { EditIcon, FileCode, SquarePlay, ToggleLeftIcon } from "lucide-svelte";
    import { compassCode, marasiConfig} from "../../stores";
    import ScopeTester from "../../lib/components/ScopeTester.svelte";

    const toastStore = getToastStore();
    const drawerStore = getDrawerStore();
    let compassMenu = [
        {
            name: "Toggle Compass Settings",
            subtitle: "Toggle Settings Accordian",
            icon: ToggleLeftIcon,
            keywords: "settings, toggle",
            action: {
                handler: () => {
                    accOpened = !accOpened;
                },
                options: { scope: "compass", single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        {
            name: "Update Compass Code",
            subtitle: "Execute compass code",
            icon: SquarePlay,
            keywords: "compass, toggle",
            action: {
                handler: () => {
                    RunExtension("compass", $compassCode)
                        .then(() => {
                            const toastSettings = {
                                message: "Updated Compass",
                                background: "variant-filled-success",
                            };
                            toastStore.trigger(toastSettings);
                        })
                        .catch((error) => {
                            const toastSettings = {
                                message: "Error updating rules",
                                background: "variant-filled-error",
                            };
                            toastStore.trigger(toastSettings);
                        });
                },
                options: { scope: "compass", single: true },
                keys: ["⌘+⇧+R", "ctrl+⇧+R"],
            },
        },
        {
            name: "Edit Compass",
            subtitle: "Jump to Code Editor",
            keywords: "code, editor",
            icon: EditIcon,
            action: {
                handler: () => {
                    const cmContent = document.querySelector(
                        'div[data-language="lua"]',
                    );
                    cmContent.focus();
                },
                options: { scope: "compass", single: true },
                keys: ["⌘+⇧+E", "ctrl+⇧+E"],
            },
        },
        {
            name: "Show Logs", 
            subtitle: "Show Extension Logs", 
            keywords: 'logs, lua',
            icon: FileCode,
            action: {
                handler: () => {
                    if ($drawerStore.open) {
                        drawerStore.close();
                    } else {
                        const drawerSettings = {
                            id: "extension-logs",
                            meta: {
                                extensionName: "compass",
                            },
                            height: "h-full",
                            width: "w-3/5",
                            position: "right"
                        };
                        drawerStore.open(drawerSettings);
                    }
                },
                options: {scope: "compass", single: true},
                keys: ["⌘+⇧+L", "ctrl+⇧+L"]
            }, 
        },
    ];
    let accOpened = false;
</script>

<MarasiKeys scope="compass" menuOptions={compassMenu} />
<Accordion rounded="false">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Compass Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <ScopeTester />
            <!-- <div class="flex justify-center mt-2 p-2">
                <button
                    type="button"
                    class="btn variant-filled-primary"
                    on:click={() => {
                        RunExtension("compass", $compassCode)
                            .then(() => {
                                console.log("Success");
                            })
                            .catch((error) => {
                                console.log(error);
                            });
                    }}>Execute</button
                >
            </div> -->
        </svelte:fragment>
    </AccordionItem>
    <!-- ... -->
</Accordion>
<div>
    <CodeMirror
        bind:value={$compassCode}
        class="text-xs"
        theme={oneDark}
        extensions={$marasiConfig.VimEnabled ? [vim(), StreamLanguage.define(lua)] : [StreamLanguage.define(lua)]}
    />
</div>

