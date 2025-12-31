<script>
    export let extensionData;
    export let classes = "max-w-full";
</script>

<div class={classes}>
    <slot {extensionData} />
</div>
