<script>
    import { getModalStore } from "@skeletonlabs/skeleton";
    import CodeMirror from "svelte-codemirror-editor";
    import { javascript } from "@codemirror/lang-javascript";
    import { oneDark } from "@codemirror/theme-one-dark";
    import { vim } from "@replit/codemirror-vim";
    import { X } from "lucide-svelte";

    export let parent;
    let content = '';
    const modalStore = getModalStore();
    const cBase = 'card p-4 w-modal shadow-xl space-y-4';

    // Reactive statement to update content when modalStore changes
    $: if ($modalStore[0] && $modalStore[0].content) {
        // Check if content is already a string
        if (typeof $modalStore[0].content === 'string') {
            content = $modalStore[0].content;
        } else {
            // Try to stringify if it's not a string
            try {
                content = JSON.stringify($modalStore[0].content, null, 2);
            } catch (e) {
                content = String($modalStore[0].content);
            }
        }
    }
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
        <CodeMirror
            class="text-xs"
            bind:value={content}
            lang={javascript()}
            lineWrapping={true}
            theme={oneDark}
            extensions={vim()}
            readonly={true}
        />
    </div>
{/if}
