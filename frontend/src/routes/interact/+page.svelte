<script>
    import { onMount } from "svelte";
    import { interactActivator } from "../../lib/interact.js";

    // You can set the src as a variable if needed, or directly in the iframe
    onMount(() => {
        let active = true;
        const show = () => document.getElementById("interact")?.classList.remove("hidden");
        if (document.getElementById("interact")) {
            show();
        } else {
            interactActivator
                .activate()
                .then(() => {
                    if (active) show();
                })
                .catch((err) => console.error("Loading Interactsh failed:", err));
        }
        return () => {
            active = false;
            document.getElementById("interact")?.classList.add("hidden");
        };
    });
</script>