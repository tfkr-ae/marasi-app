<script>
    import { Drawer } from "@skeletonlabs/skeleton";
    import { getDrawerStore } from "@skeletonlabs/skeleton";
    const drawerStore = getDrawerStore();
    import ExtensionLogs from "./ExtensionLogs.svelte";
    import RequestResponseView from "./RequestResponseView.svelte";
    import ExtensionDrawerWrapper from "../extensions/components/ExtensionDrawerWrapper.svelte";
</script>

<Drawer position="bottom" rounded="0" height="h-3/5" width="w-full">
    {#if $drawerStore.id === "request-response"}
        <RequestResponseView
            showSizeToggle={true}
            request_id={$drawerStore.meta.request.ID}
            titleText={"Request " + $drawerStore.meta.requestIndex}
            isFiltered={$drawerStore.meta.isFiltered}
            incomingResponse={$drawerStore.meta.incomingResponse}
        />
    {/if}
    {#if $drawerStore.id === "extension-logs"}
        <ExtensionLogs extensionName={$drawerStore.meta.extensionName} />
    {/if}
    {#if $drawerStore.id === "extension-drawer"}
        <ExtensionDrawerWrapper />
    {/if}
</Drawer>
