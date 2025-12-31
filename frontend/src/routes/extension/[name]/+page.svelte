<script>
    import { page } from "$app/stores";
    import { extensions, extensions_ui } from "../../../stores.js";
    import ExtensionUI from "../../../lib/extensions/ExtensionUI.svelte";
    import { Accordion, AccordionItem } from "@skeletonlabs/skeleton";
    import { SettingsIcon, ToggleLeftIcon } from "lucide-svelte";
    import * as Icons from "lucide-svelte";
    import MarasiKeys from "../../../lib/components/MarasiMenu/MarasiKeys.svelte";
    import { EventsEmit } from "../../../lib/wailsjs/runtime/runtime.js";
    let accOpened = false;

    $: extensionName = $page.params.name;
    $: extensionData = $extensions.find((ext) => ext.Name === extensionName);

    $: menuSchema = $extensions_ui[extensionName]?.menu;
    $: mainSchema = $extensions_ui[extensionName]?.main;
    $: panelSchema = $extensions_ui[extensionName]?.panel;
    $: menuOptions = [
        {
            name: `Toggle ${extensionName} Settings`,
            subtitle: "Toggle Settings Accordian",
            keywords: "settings, toggle",
            icon: ToggleLeftIcon,
            action: {
                handler: () => (accOpened = !accOpened),
                options: { scope: extensionName, single: true },
                keys: ["⌘+P", "ctrl+P"],
            },
        },
        ...(Array.isArray(menuSchema) ? menuSchema : []).map((item) => ({
            name: item.name,
            subtitle: item.subtitle || "",
            keywords: item.keywords || "",
            icon: Icons[item.icon] || Icons.HelpCircle,
            action: {
                handler: () => {
                    if (item.action) {
                        EventsEmit("extension_call_function", {
                            extensionID: extensionData.ID,
                            function: item.action,
                        });
                    }
                },
                options: {
                    scope: extensionName,
                    single: true,
                },
                keys: item.keys || [],
            },
        })),
    ];
</script>

<MarasiKeys scope={extensionName} {menuOptions} />
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
