<script>
    import { getModalStore } from "@skeletonlabs/skeleton";

    export let extensionData;

    export let label = "Open Modal";
    export let triggerClasses = "btn btn-primary";
    export let icon = null;

    export let title = "Modal Title";
    export let bodySchema = null;
    export let backdropClasses = "";

    const modalStore = getModalStore();

    function openModal() {
        if (!bodySchema) return;

        const modal = {
            type: "component",
            component: "extension-modal",
            meta: {
                title,
                schema: bodySchema,
                extensionData,
            },
            backdropClasses,
        };
        modalStore.trigger(modal);
    }
</script>

<button class={triggerClasses} on:click={openModal}>
    {#if icon}
        <span>{icon}</span>
    {/if}
    <span>{label}</span>
</button>
