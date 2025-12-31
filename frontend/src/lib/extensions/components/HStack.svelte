<script>
    export let extensionData;
    export let classes =
        "flex flex-row flex-wrap gap-4 items-center justify-start";
</script>

<div class={classes}>
    <slot {extensionData} />
</div>
