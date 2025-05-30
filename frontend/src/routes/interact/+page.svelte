<script>
    import { onMount } from "svelte";

    // You can set the src as a variable if needed, or directly in the iframe
    onMount(() => {
        const svelteChef = document.getElementById("interact");
        svelteChef.classList.remove("hidden");
        return () => {
        svelteChef.classList.add("hidden");
        }
    });
</script>