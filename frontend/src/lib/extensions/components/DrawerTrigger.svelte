<script>
    import { getDrawerStore } from "@skeletonlabs/skeleton";
    import Icon from "./Icon.svelte";

    export let extensionData;

    export let label = "Open Drawer";
    export let triggerClasses = "btn btn-primary";
    export let icon = null;

    export let title = "Drawer";
    export let bodySchema = null;
    export let position = "right";
    export let width = "w-[280px] md:w-[480px]";
    export let height = "h-full";
    export let padding = "p-4";
    export let rounded = "rounded-none";

    const drawerStore = getDrawerStore();

    function openDrawer() {
        if (!bodySchema) return;

        const drawerSettings = {
            id: "extension-drawer",
            meta: {
                title,
                schema: bodySchema,
                extensionData,
                classes: `${width} ${height} ${padding} ${rounded} bg-surface-100-800-token`,
            },
            position: position,
            width: width,
            height: height,
            padding: padding,
            rounded: rounded,
            bgDrawer: "bg-surface-100-800-token",
        };
        drawerStore.open(drawerSettings);
    }
</script>

<button class={triggerClasses} on:click={openDrawer}>
    {#if icon}
        <Icon {icon} size={18} />
    {/if}
    <span>{label}</span>
</button>
