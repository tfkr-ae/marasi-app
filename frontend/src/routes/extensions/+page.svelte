<script>
    import { onMount } from "svelte";
    import { CheckExtensionUpdates, DownloadExtension, GetExtensions, UninstallExtension } from "../../lib/wailsjs/go/main/App";
    import { TreeView, TreeViewItem, RecursiveTreeView} from '@skeletonlabs/skeleton';
    import { ArrowUpCircleIcon, PlusIcon, Trash2Icon } from "svelte-feather-icons";
    import MarasiKeys from "../../lib/components/MarasiMenu/MarasiKeys.svelte";
    
    let extensions = {};
    let hasUpdates = {};
    let url;
    function createExtensionSetting(name) {
        if (name === "JWT Extension") {
            document.getElementById(name).replaceChildren(document.createElement("dump-setting"));
        } else {
        document.getElementById(name).replaceChildren(document.createElement(name+ "-setting"));
        }
    }
    function downloadExtension() {
        DownloadExtension(url, false).then(() => {
            ReloadExtensions();
        })
    }

    function ReloadExtensions() {
        GetExtensions().then((ext) => {extensions = ext; CheckExtensionUpdates().then((updates) => {hasUpdates = updates})});
    }
    onMount(() => {
        ReloadExtensions();
    })
</script>
    <MarasiKeys
        scope="all"
        menuOptions={[]}
    />
<div class="container mx-auto p-8 space-y-8">
	<h1 class="h1">Extensions</h1>
	<h4 class="h4">Install new extension</h4>
    <div class="flex items-center space-x-2">
        <label class="label flex items-center space-x-2">
            <span>Input</span>
            <input bind:value={url} class="input p-1 rounded-none" type="text" placeholder="Extension URL" />
        </label>
        <button on:click={downloadExtension} type="button" class="btn variant-filled flex items-center space-x-1">
            <PlusIcon />
            <span>Install</span>
        </button>
    </div>
    <h4 class="h4">Active Extensions</h4>
    <TreeView>
        {#each Object.entries(extensions) as [name, extension]}
            {#if (name !== "workshop" && name !== "checkpoint" && name !== "compass")}
            <TreeViewItem on:toggle={createExtensionSetting(name)} class="extension-item">
                <div class="extension-name">
                    {#if (name !== "workshop" && name !== "checkpoint")}
                        <button class="chip variant-filled-primary hover:variant-filled items-center update-button" on:click={UninstallExtension(name).then(() => {
                            ReloadExtensions();
                        })}>
                            <span class="pl-1"><Trash2Icon/></span>
                        </button>
                    {/if}
                        <span>{name} - {extension.Author}</span>
                    {#if hasUpdates[name]}
                        <button class="chip variant-filled hover:variant-filled-primary items-center update-button" on:click={DownloadExtension(extension.SourceURL, false).then((error) => {
                            ReloadExtensions();
                        })}>
                            Update Available
                            <span class="pl-1"><ArrowUpCircleIcon/></span>
                        </button>
                    {/if}
                </div>
                <svelte:fragment slot="children">
                    <div id={name}></div>
                </svelte:fragment>
            </TreeViewItem>
            {/if}
        {/each}
    </TreeView>
</div>

<style>
    .extension-item {
    display: flex;
    align-items: center; /* Vertically centers content */
    justify-content: space-between; /* Spaces the name and button */
}

.extension-name {
    display: flex;
    align-items: center;
    gap: 10px; /* Adjusts the spacing between the name and button */
}

.update-button {
    margin-left: 10px; /* Additional spacing from the name if needed */
}
</style>