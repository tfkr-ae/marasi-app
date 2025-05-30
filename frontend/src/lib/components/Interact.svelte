<script>
    import {onMount } from "svelte";
    export let isVisible = false; // Prop to control visibility
    let url = "https://app.interactsh.com";
    onMount(() => {
        return () => {
            isVisible = false;
        }
    })
</script>

{#if isVisible}
    <div class="iframe-container">
        <iframe id="interact" class="cyberchef-iframe" src={url} title="InteractSH">
            <!-- Fallback content for browsers that do not support iframes -->
            <p>Your browser does not support iframes.</p>
        </iframe>
    </div>
{:else}
    <div class="iframe-placeholder"></div>
{/if}

<style>
.iframe-container {
    position: relative;
    width: 100%;
    height: 100%;
    opacity: 1;
    display: contents;
    visibility: visible;
    transition: opacity 0.3s, visibility 0.3s;
}
.cyberchef-iframe {
    width: 100%;   /* Full width of the container */
    height: 100%;
    border: none;  /* Optional: removes iframe border */
}
.iframe-placeholder {
    display: none;
}
</style>