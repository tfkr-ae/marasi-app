<script>
    import { setContext } from "svelte";

    export let extensionData;
    export let classes = "btn-group horizontal variant-filled-primary";

    setContext("ButtonGroup", true);
</script>

<div class={classes}>
    <slot {extensionData} />
</div>
