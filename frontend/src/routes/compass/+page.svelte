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
    import { extensionsStore } from "../../stores/extensionsStore.js";
    import MarasiMenu from "../../lib/components/MarasiMenu/MarasiMenu.svelte";
    import { useMenuActions } from "../../lib/keybindings/app.js";
    import {
        EditIcon,
        FileCode,
        SettingsIcon,
        SquarePlay,
        ToggleLeftIcon,
    } from "lucide-svelte";
    import { compassCode, marasiConfig } from "../../stores";
    import ScopeTester from "../../lib/components/ScopeTester.svelte";
    import { autocompletion } from "@codemirror/autocomplete";
    import { marasiCompletionSource } from "../../lib/autocomplete/autocomplete";
    import { isSuperseded } from "../../lib/service/errors.js";

    const toastStore = getToastStore();
    const drawerStore = getDrawerStore();
    let compassMenu = [
        {
            actionId: "compass.toggle-settings",
            icon: ToggleLeftIcon,
            handler: () => {
                accOpened = !accOpened;
            },
        },
        {
            actionId: "compass.update-rules",
            icon: SquarePlay,
            handler: () => {
                extensionsStore.run("compass", $compassCode)
                    .then(() => {
                        const toastSettings = {
                            message: "Updated Compass",
                            background: "variant-filled-success",
                        };
                        toastStore.trigger(toastSettings);
                    })
                    .catch((error) => {
                        // A connection switch stopped it: nothing to report.
                        if (isSuperseded(error)) return;
                        const toastSettings = {
                            message: "Error updating rules",
                            background: "variant-filled-error",
                        };
                        toastStore.trigger(toastSettings);
                    });
            },
        },
        {
            actionId: "compass.edit-rules",
            icon: EditIcon,
            handler: () => {
                const cmContent = document.querySelector(
                    'div[data-language="lua"]',
                );
                cmContent.focus();
            },
        },
        {
            actionId: "compass.show-logs",
            icon: FileCode,
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
                        position: "right",
                    };
                    drawerStore.open(drawerSettings);
                }
            },
        },
    ];
    useMenuActions(compassMenu);
    let accOpened = false;
</script>

<MarasiMenu paletteTier="page" pageName="Compass" pageEntries={compassMenu} />
<Accordion rounded="false" padding="py-3 px-3" regionControl="text-sm font-bold" class="bg-surface-50 dark:bg-surface-900 text-surface-900-50-token">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon size="16" /></svelte:fragment>
        <svelte:fragment slot="summary">Compass Settings</svelte:fragment>
        <svelte:fragment slot="content">
            <ScopeTester />
        </svelte:fragment>
    </AccordionItem>
</Accordion>
<div>
    <CodeMirror
        bind:value={$compassCode}
        class="text-xs"
        styles={{ "&": { fontSize: "0.6875rem" } }}
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
