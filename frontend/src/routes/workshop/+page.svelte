<script>
    import { StreamLanguage } from "@codemirror/language";
    import { lua } from "@codemirror/legacy-modes/mode/lua";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { githubLight } from "@uiw/codemirror-theme-github";
    import { vim } from "@replit/codemirror-vim";
    import {
        Accordion,
        AccordionItem,
        getDrawerStore,
        getToastStore,
        modeCurrent,
    } from "@skeletonlabs/skeleton";
    import CodeMirror from "svelte-codemirror-editor";
    import { DoExtender, RunExtension } from "../../lib/wailsjs/go/main/App";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        EditIcon,
        FileCode,
        SettingsIcon,
        SquarePlay,
        ToggleLeftIcon,
    } from "lucide-svelte";
    import { workshopCode, marasiConfig } from "../../stores";
    import { autocompletion } from "@codemirror/autocomplete";
    import { marasiCompletionSource } from "../../lib/autocomplete/autocomplete";

    let accOpened = false;
    const toastStore = getToastStore();
    const drawerStore = getDrawerStore();
    const workshopMenu = [
        {
            name: "Toggle Workshop Settings",
            subtitle: "Toggle Settings Accordian",
            keywords: "settings, toggle",
            icon: ToggleLeftIcon,
            action: {
                handler: () => {
                    accOpened = !accOpened;
                },
                options: { scope: "workshop", single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        {
            name: "Edit Workshop",
            subtitle: "Jump to code editor",
            keywords: "edit, code",
            icon: EditIcon,
            action: {
                handler: () => {
                    const cmContent = document.querySelector(
                        'div[data-language="lua"]',
                    );
                    cmContent.focus();
                },
                options: { scope: "workshop", single: true },
                keys: ["⌘+⇧+E", "ctrl+⇧+E"],
            },
        },
        {
            name: "Update Workshop",
            subtitle: "Execute Workshop Code",
            keywords: "execute, code",
            icon: SquarePlay,
            action: {
                handler: () => {
                    RunExtension("workshop", $workshopCode)
                        .then(() => {
                            const toastSettings = {
                                message: "Updated Workshop",
                                background: "variant-filled-success",
                            };
                            toastStore.trigger(toastSettings);
                        })
                        .catch((error) => {
                            const toastSettings = {
                                message: "Error updating " + error,
                                background: "variant-filled-error",
                            };
                            toastStore.trigger(toastSettings);
                        });
                },
                options: { scope: "workshop", single: true },
                keys: ["⌘+⇧+R", "ctrl+⇧+R"],
            },
        },
        {
            name: "Show Logs",
            subtitle: "Show Extension Logs",
            keywords: "logs, lua",
            icon: FileCode,
            action: {
                handler: () => {
                    console.log($drawerStore);
                    if ($drawerStore.open) {
                        drawerStore.close();
                    } else {
                        const drawerSettings = {
                            id: "extension-logs",
                            meta: {
                                extensionName: "workshop",
                            },
                            height: "h-full",
                            width: "w-3/5",
                            position: "right",
                        };
                        drawerStore.open(drawerSettings);
                    }
                },
                options: { scope: "workshop", single: true },
                keys: ["⌘+⇧+L", "ctrl+⇧+L"],
            },
        },
    ];
</script>

<MarasiKeys scope="workshop" menuOptions={workshopMenu} />
<Accordion rounded="false" class="bg-surface-50 dark:bg-surface-900 text-surface-900-50-token">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary">Workshop Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <div class="flex justify-center mt-2 p-2">
                <button
                    type="button"
                    class="btn {$modeCurrent ? 'variant-ghost-primary ring-0 shadow-none' : 'variant-filled-primary'}"
                    on:click={() => {
                        DoExtender($workshopCode);
                    }}>Execute</button
                >
            </div>
        </svelte:fragment>
    </AccordionItem>
</Accordion>
<div>
    <CodeMirror
        bind:value={$workshopCode}
        class="text-xs"
        theme={$modeCurrent ? githubLight : oneDark}
        extensions={$marasiConfig.VimEnabled
            ? [
                  vim(),
                  StreamLanguage.define(lua),
                  autocompletion({
                      override: [marasiCompletionSource],
                  }),
              ]
            : [
                  StreamLanguage.define(lua),
                  autocompletion({
                      override: [marasiCompletionSource],
                  }),
              ]}
    />
</div>
