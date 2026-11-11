<script>
    import { getModalStore, modeCurrent } from "@skeletonlabs/skeleton";
    import { onMount, tick } from "svelte";
    import { projectStore } from "../../stores/projectStore.js";
    import { newProject, pickerChoice, pickerRows } from "../../stores/projectApi.js";
    import { connectionStore } from "../../stores/connectionStore.js";
    import { filePickerShown } from "../connection/status.js";
    import { neutralVariant, primaryVariant } from "../launchpad/format.js";
    import { OpenFileDialog } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
    import { FolderOpen, Plus, X } from "lucide-svelte";

    export let parent;
    const modalStore = getModalStore();

    let projects = [];
    let rows = [];
    let ready = false;
    let input = "";
    let selected = -1;
    let list;

    // Typed text that names no listed project gets a Create row above the
    // matches; Enter takes the selected row (pickerRows).
    $: ({ rows, selected } = pickerRows(projects, input));
    $: row = rows[selected];
    $: creating = row?.kind === "create" ? newProject(row.text) : null;

    function choose(r = row) {
        if (!r) return;
        $modalStore[0].response(pickerChoice(r));
        modalStore.close();
    }

    async function openFileSelector() {
        try {
            const selectedPath = await OpenFileDialog();
            if (selectedPath) {
                $modalStore[0].response(selectedPath);
                modalStore.close();
            }
        } catch (error) {
            console.error("Error opening file dialog:", error);
        }
    }

    async function handleKeydown(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            choose();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            selected = Math.max(0, Math.min(rows.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
            await tick();
            list?.querySelector(".project-item.selected")?.scrollIntoView({ block: "nearest", behavior: "auto" });
        }
    }

    function focus(node) {
        setTimeout(() => node.focus(), 10);
    }

    onMount(() => {
        // The recent projects, then the service's other named projects.
        projectStore
            .list()
            .then((listed) => (projects = listed))
            .catch((error) => console.error("Listing projects failed:", error))
            .finally(() => (ready = true));
    });
</script>

{#if $modalStore[0]}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="card p-4 w-modal shadow-xl space-y-3 text-sm bg-surface-50-800-token text-surface-900-50-token rounded-0" on:keydown={(event) => {
        if (event.key === "Escape") {
            event.stopImmediatePropagation();
            modalStore.close();
        }
    }}>
        <header class="flex justify-between items-center">
            <h2 class="text-base font-bold">{$modalStore[0].title ?? "(title missing)"}</h2>
            <button class="text-2xl leading-none" aria-label="Close" on:click={modalStore.close}>
                <X size={16} />
            </button>
        </header>
        <form class="space-y-3" on:submit|preventDefault>
            <input class="input w-full h-8 py-1 text-sm bg-white dark:bg-surface-700 border-0 ring-0 focus:border-0 focus:ring-0"
                   type="search"
                   name="project-name"
                   autocomplete="off"
                   autocorrect="off"
                   autocapitalize="off"
                   spellcheck="false"
                   use:focus
                   bind:value={input}
                   placeholder="Find or create a project"
                   on:keydown={handleKeydown} />

            <div bind:this={list} class="card w-full h-64 overflow-y-auto p-0 bg-white dark:bg-surface-700">
                {#if !input.trim()}
                    <div class="px-4 py-2 text-xs opacity-60 flex items-center gap-2">
                        <Plus size={12} /> Type a name to create a project
                    </div>
                {/if}
                <ul class="project-list">
                    {#each rows as r, i}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                        <li class="project-item {selected === i ? 'selected' : ''} {r.kind}"
                            on:click={() => (selected = i)}
                            on:dblclick={() => choose(r)}>
                            {#if r.kind === "create"}
                                {@const made = newProject(r.text)}
                                <div class="project-name flex items-center gap-2"><Plus size={14} /> Create “{made.name}”</div>
                                <div class="project-path">New project · {made.path ?? "Projects folder"}</div>
                            {:else}
                                <div class="project-name">{r.project.name}</div>
                                <div class="project-path">{r.project.path}</div>
                            {/if}
                        </li>
                        {#if r.kind === "create" && rows.length > 1}
                            <li class="text-xs opacity-50 px-4 pt-2 pb-1 uppercase tracking-wide">Existing projects</li>
                        {/if}
                    {/each}
                </ul>
                {#if ready && !rows.length}
                    <div class="p-4 text-center text-xs opacity-70">No projects yet</div>
                {/if}
            </div>

            <div class="flex gap-2">
                <!-- Browse: local only; a remote's projects open from the list or a typed path. -->
                {#if filePickerShown($connectionStore.connection)}
                    <button type="button" class="btn btn-sm {neutralVariant($modeCurrent)}" on:click={openFileSelector}>
                        <FolderOpen size={14} /><span>Browse…</span>
                    </button>
                {/if}
                <button type="button" class="btn btn-sm flex-1 min-w-0 {primaryVariant($modeCurrent)}" disabled={!row} on:click={() => choose()}>
                    <span class="truncate">
                        {#if creating}Create “{creating.name}”{:else if row}Open {row.project.name}{:else}Open{/if}
                    </span>
                </button>
            </div>
        </form>
    </div>
{/if}

<style>
    .project-list {
        list-style-type: none;
        padding: 0;
        margin: 0;
    }

    .project-item {
        padding: 0.75rem 1rem;
        cursor: pointer;
    }

    .project-item.create {
        border-bottom: 1px dashed rgb(var(--color-surface-500) / 0.3);
    }

    .project-item:hover,
    .project-item.selected {
        background-color: rgb(var(--color-primary-100));
    }

    :global(.dark) .project-item:hover,
    :global(.dark) .project-item.selected {
        background-color: rgb(var(--color-primary-500) / 0.2);
    }

    .project-name {
        font-weight: 500;
        margin-bottom: 0.25rem;
    }

    .project-path {
        font-size: 0.8rem;
        opacity: 0.7;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
