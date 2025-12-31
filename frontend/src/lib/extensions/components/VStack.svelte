<script>
    export let extensionData;
    export let classes = "flex flex-col gap-4 items-stretch justify-start";
</script>

<div class={classes}>
    <slot {extensionData} />
</div>
