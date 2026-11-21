<script>
    import { onMount } from "svelte";

    // You can set the src as a variable if needed, or directly in the iframe
    onMount(() => {
        const frame = document.getElementById("interact");
        frame.classList.remove("hidden");
        return () => {
        frame.classList.add("hidden");
        }
    });
</script>