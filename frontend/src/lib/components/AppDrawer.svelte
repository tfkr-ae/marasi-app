<script>
    import { Drawer } from '@skeletonlabs/skeleton';
    import { getDrawerStore } from "@skeletonlabs/skeleton";
    const drawerStore = getDrawerStore();
    import RequestResponse from './RequestResponse.svelte';
    import ExtensionLogs from './ExtensionLogs.svelte';
    import RequestResponseView from './RequestResponseView.svelte';

</script>

<Drawer position="bottom" rounded="0" height="h-3/5" width="w-full">
    {#if $drawerStore.id === 'request-response'}
        <!-- <RequestResponse showToggle={true} requestTitle={"Request " + $drawerStore.meta.requestIndex} request={$drawerStore.meta.request} response={$drawerStore.meta.response} metadata={$drawerStore.meta.metadata}></RequestResponse> -->
        <RequestResponseView showSizeToggle={true} request_id={$drawerStore.meta.request.ID} titleText={"Request " + $drawerStore.meta.requestIndex}/>
    {/if}
    {#if $drawerStore.id === "extension-logs"}
        <ExtensionLogs extensionName={$drawerStore.meta.extensionName}/>
    {/if}
</Drawer>
