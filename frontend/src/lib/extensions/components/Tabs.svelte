<script>
    import { extensions_ui } from "../../../stores";
    import { resolveBind, updateBind } from "./utils";
    import { TabGroup, Tab } from "@skeletonlabs/skeleton";
    import Renderer from "../Renderer.svelte";

    export let extensionData;
    export let value = { bind: "" };
    export let items = [];
    export let classes = "w-full";

    const activeTabPath = { bind: `__activeTab_${value.bind}` };

    $: storedTab = resolveBind($extensions_ui, extensionData, activeTabPath);

    $: activeTab = storedTab || (items.length > 0 ? items[0].value : "");

    function onTabChange(newValue) {
        updateBind(extensionData, activeTabPath, newValue);
    }
</script>

<div class={classes}>
    <TabGroup>
        {#each items as item}
            <Tab
                group={activeTab}
                name={item.value}
                value={item.value}
                on:change={() => onTabChange(item.value)}
            >
                {item.label}
            </Tab>
        {/each}

        <svelte:fragment slot="panel">
            {#each items as item}
                {#if activeTab === item.value && item.panel}
                    <div
                        class="p-4 border border-t-0 border-surface-500/30 rounded-b-container"
                    >
                        <Renderer schema={item.panel} {extensionData} />
                    </div>
                {/if}
            {/each}
        </svelte:fragment>
    </TabGroup>
</div>
