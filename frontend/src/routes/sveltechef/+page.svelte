<script>
    import { onMount } from "svelte";

    export const input = "";
    // You can set the src as a variable if needed, or directly in the iframe
    let url = "https://gchq.github.io/CyberChef?theme=dark&input=" + input;
    $: console.log(url)
    onMount(() => {
        const svelteChef = document.getElementById("sveltechef");
        svelteChef.classList.remove("hidden");
        return () => {
        svelteChef.classList.add("hidden");
        }
    });
</script>