<script>
    import { getModalStore } from "@skeletonlabs/skeleton";
    import { onMount, tick } from "svelte";
    import { GetRecentProjects } from "../wailsjs/go/main/App";
    import { OpenFileDialog } from "../wailsjs/go/main/App";
    import { X } from "lucide-svelte";

    export let parent;
    let recent = [];
    let input = '';
    let filteredList = [];
    let selectedIndex = -1;
    const modalStore = getModalStore();
    const cBase = 'card p-4 w-modal shadow-xl space-y-4';
    const cHeader = 'text-2xl font-bold';
    const cForm = 'space-y-4';
    
    function onInput(selected) {
        if (selected && selected.detail) {
            $modalStore[0].response(selected.detail.value);
            modalStore.close();
        }
    }

    function createNewProject() {
        if (input.trim()) {
            $modalStore[0].response(input.trim());
            modalStore.close();
        }
    }
    
    function openSelected() {
        console.log(selectedIndex)
        console.log(filteredList)
        if (selectedIndex >= 0 && selectedIndex < filteredList.length) {
            $modalStore[0].response(filteredList[selectedIndex].value);
            modalStore.close();
        } else if (filteredList.length > 0) {
            $modalStore[0].response(filteredList[0].value);
            modalStore.close();
        } else {
            createNewProject();
        }
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
    
    function selectProject(index) {
        selectedIndex = index;
    }
    
    function filterProjects() {
        if (!input.trim()) {
            filteredList = recent;
            return;
        }
        
        filteredList = recent.filter(option => 
            option.label.toLowerCase().includes(input.toLowerCase()) || 
            option.value.toLowerCase().includes(input.toLowerCase())
        );
        
        // Reset selected index when filter changes
        selectedIndex = filteredList.length > 0 ? 0 : -1;
    }
    
    async function handleKeydown(event) {
        if (event.key === 'Enter') {
            // Changed condition to check if an item is selected instead of checking input
            event.preventDefault();
            openSelected();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (selectedIndex < filteredList.length - 1) {
                selectedIndex++;
                // Wait for Svelte to update the DOM
                await tick();
                scrollSelectedIntoView();
            }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--;
                // Wait for Svelte to update the DOM
                await tick();
                scrollSelectedIntoView();
            }
        }
    }
    // Simplified scroll function - no setTimeout needed
    function scrollSelectedIntoView() {
        const selectedElement = document.querySelector('.project-item.selected');
        if (selectedElement) {
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
    } 
    // Watch input changes to update filtered list
    $: {
        input;
        filterProjects();
    }
    
    onMount(() => {
        GetRecentProjects().then((recents) => {
            const placeholder = []
            recents.forEach((project) => {
                console.log(project)
                // Get just the filename for display
                const fileName = project.ProjectName.split("/").pop()?.split("\\").pop() || project.ProjectName;
                const entry = {
                    // The label is now the name for display in the UI
                    label: fileName.replace('.marasi', ''),
                    // Store full path in value
                    value: project.ProjectName,
                    // Store the path separately for display
                    path: project.ProjectName,
                    // Store the date for sorting
                    date: new Date(project.Date)
                }
                placeholder.push(entry);
            });
            
            // Sort projects by date, most recent first
            placeholder.sort((a, b) => b.date - a.date);
            
            recent = placeholder;
            filteredList = placeholder;
            if (filteredList.length > 0) {
                selectedIndex = 0;
            }
            
            // Focus the input field after loading
            setTimeout(() => {
                document.querySelector('input[type="search"]')?.focus();
            }, 10);
        });
    });
</script>

{#if $modalStore[0]}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-example-form {cBase} rounded-0" on:keydown={(event) => {
		if (event.key === 'Escape') {
            event.stopImmediatePropagation();
            modalStore.close();
        } 
    }}>
		<header class="flex justify-between items-center">
			<h2 class="text-xl font-bold">
				{$modalStore[0].title ?? '(title missing)'}
			</h2>
			<button class="text-2xl leading-none focus:outline-none" tabindex="-1" on:click={modalStore.close}>
				<X />
			</button>
		</header>
        <form class="modal-form {cForm}" on:submit|preventDefault>
            <!-- SEARCH BAR AT TOP -->
            <div class="relative w-full mb-2">
                <input class="input w-full" 
                       type="search" 
                       name="search" 
                       bind:value={input} 
                       placeholder="Search or enter new project name..." 
                       on:keydown={handleKeydown} />
            </div>
            
            <!-- RECENT PROJECTS LIST -->
            <div class="card w-full h-64 overflow-y-auto p-0">
                {#if filteredList.length > 0}
                    <ul class="project-list">
                        {#each filteredList as project, i}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                            <li class="project-item {selectedIndex === i ? 'selected' : ''}" 
                                on:click={() => selectProject(i)}
                                on:dblclick={() => {
                                    selectProject(i);
                                    openSelected();
                                }}>
                                <div class="project-name">{project.label}</div>
                                <div class="project-path">{project.path}</div>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <div class="p-4 text-center text-surface-500">
                        {input.trim() ? 'No matching projects found' : 'No recent projects'}
                    </div>
                {/if}
            </div>
            
            <!-- PRIMARY ACTION BUTTON -->
            <div class="w-full mt-4">
                <button 
                    type="button"
                    class="btn variant-filled-secondary w-full"
                    on:click={openSelected}
                >
                    {filteredList.length > 0 ? 'Open Selected' : 'Create New Project'}
                </button>
            </div>
            
            <!-- ALTERNATIVE ACTION (BROWSE FILES) -->
             <hr>
            <div class="w-full mt-2">
                <button 
                    type="button"
                    class="btn variant-filled-primary w-full"
                    on:click={openFileSelector}
                >
                    Browse Files...
                </button>
            </div>
            
            <!-- Simple information about project creation behavior -->
            <div class="text-sm text-surface-300 mt-2">
                {#if !input.includes('/') && !input.includes('\\')}
                    New projects with just a name will be created in the default directory.
                {/if}
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
    
    .project-item:hover {
        background-color: #cf595b;
        opacity: 80%;
    }
    
    .project-item.selected {
        background-color: #cf595b;
        opacity: 80%;
    }
    
    .project-item.selected .project-path {
        color: #fffff0;
    }
    
    .project-name {
        font-weight: 500;
        margin-bottom: 0.25rem;
    }
    
    .project-path {
        font-size: 0.8rem;
        color: #fffff0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>