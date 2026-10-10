<script>
    import { onDestroy } from "svelte";
    import { page } from "$app/stores";
    import { extensions, extensions_ui } from "../../../stores.js";
    import ExtensionUI from "../../../lib/extensions/ExtensionUI.svelte";
    import { Accordion, AccordionItem } from "@skeletonlabs/skeleton";
    import { SettingsIcon, ToggleLeftIcon } from "lucide-svelte";
    import * as Icons from "lucide-svelte";
    import MarasiKeys from "../../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import { registerMenuActions } from "../../../lib/keybindings/app.js";
    import {
        extensionMenuActionId,
        extensionPageActionId,
    } from "../../../lib/keybindings/catalog.js";
    import { EventsEmit } from "../../../lib/wailsjs/runtime/runtime.js";
    let accOpened = false;

    $: extensionName = $page.params.name;
    $: extensionData = $extensions.find((ext) => ext.Name === extensionName);

    $: menuSchema = $extensions_ui[extensionName]?.menu;
    $: mainSchema = $extensions_ui[extensionName]?.main;
    $: panelSchema = $extensions_ui[extensionName]?.panel;

    function callExtension(action) {
        EventsEmit("extension_call_function", {
            extensionID: extensionData.ID,
            function: action,
            state: $extensions_ui[extensionData.Name],
        });
    }

    // Declared items keep their catalog identity (extension + action), so
    // the first item wins when two declare the same action, as in the
    // catalog. Items without an action are listed but run nothing.
    function declaredMenu(name, schema) {
        const seen = new Set();
        return (Array.isArray(schema) ? schema : []).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const actionId = extensionMenuActionId(
                name,
                typeof item.action === "string" ? item.action : "",
            );
            if (actionId && seen.has(actionId)) return [];
            if (actionId) seen.add(actionId);
            return [
                {
                    ...(actionId && {
                        actionId,
                        handler: () => callExtension(item.action),
                    }),
                    name: item.name,
                    subtitle: item.subtitle || "",
                    keywords: item.keywords || "",
                    icon: Icons[item.icon] || Icons.HelpCircle,
                },
            ];
        });
    }

    $: menuOptions = [
        {
            actionId: extensionPageActionId(extensionName, "toggle-settings"),
            name: `Toggle ${extensionName} Settings`,
            icon: ToggleLeftIcon,
            handler: () => (accOpened = !accOpened),
        },
        ...declaredMenu(extensionName, menuSchema),
    ];

    // The page component is reused when navigating between extensions, so
    // handlers follow the current extension and menu.
    let unregisterMenu = () => {};
    $: {
        unregisterMenu();
        unregisterMenu = registerMenuActions(
            menuOptions.filter((option) => option.actionId),
        );
    }
    onDestroy(() => unregisterMenu());
</script>

<MarasiKeys {menuOptions} />
<Accordion rounded="false">
    <AccordionItem bind:open={accOpened}>
        <svelte:fragment slot="lead"><SettingsIcon /></svelte:fragment>
        <svelte:fragment slot="summary"
            >{extensionName} Settings</svelte:fragment
        >
        <svelte:fragment slot="content">
            {#if panelSchema}
                <ExtensionUI
                    {extensionData}
                    schema={panelSchema}
                    classes="w-full"
                />
            {:else}
                <div class="flex items-center justify-center text-surface-400">
                    <div class="text-center">
                        <p class="text-sm font-semibold">No Interface Loaded</p>
                        <p class="text-xs">
                            This extension hasn't rendered to the "panel" target
                            yet.
                        </p>
                    </div>
                </div>
            {/if}
        </svelte:fragment>
    </AccordionItem>
</Accordion>
{#if mainSchema}
    <ExtensionUI
        {extensionData}
        schema={mainSchema}
        classes="w-full"
        enableSync={true}
    />
{:else}
    <div class="flex items-center justify-center text-surface-400">
        <div class="text-center">
            <p class="text-lg font-semibold">No Interface Loaded</p>
            <p class="text-sm">
                This extension hasn't rendered to the "main" target yet.
            </p>
        </div>
    </div>
{/if}
