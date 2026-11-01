<script>
	import { Drawer } from "@skeletonlabs/skeleton";
	import { getDrawerStore } from "@skeletonlabs/skeleton";
	const drawerStore = getDrawerStore();
	import ExtensionLogs from "./ExtensionLogs.svelte";
	import ExtensionDrawerWrapper from "../extensions/components/ExtensionDrawerWrapper.svelte";

	$: drawerPosition = $drawerStore?.position || "bottom";
	$: drawerHeight = $drawerStore?.height || "h-3/5";
	$: drawerWidth = $drawerStore?.width || "w-full";
	$: drawerRounded = $drawerStore?.rounded || "0";
</script>

<Drawer
	position={drawerPosition}
	rounded={drawerRounded}
	height={drawerHeight}
	width={drawerWidth}
	bgDrawer="bg-surface-100-800-token"
>
	{#if $drawerStore.id === "extension-logs"}
		<ExtensionLogs
			extensionName={$drawerStore.meta.extensionName}
		/>
	{/if}
	{#if $drawerStore.id === "extension-drawer"}
		<ExtensionDrawerWrapper />
	{/if}
</Drawer>
