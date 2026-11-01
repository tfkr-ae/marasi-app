<script>
    // Compass's scope rules on the connected instance, which follow its code.
    import { scopeStore } from "../../stores/scopeStore.js";

    $: groups = [
        { label: "Include", tone: "text-success-700 dark:text-success-400", rules: $scopeStore.includeRules },
        { label: "Exclude", tone: "text-error-700 dark:text-error-400", rules: $scopeStore.excludeRules },
    ];
</script>

<div class="w-full text-sm" data-testid="scope-rules">
    <p class="mb-2">
        <b>Default:</b>
        {#if $scopeStore.loaded}{$scopeStore.defaultAllow ? "Allow" : "Deny"}{:else}…{/if}
    </p>
    <div class="grid grid-cols-2 gap-4">
        {#each groups as group}
            <div data-scope-group={group.label.toLowerCase()}>
                <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide {group.tone}">
                    {group.label} ({group.rules.length})
                </h4>
                {#each group.rules as rule}
                    <div class="flex gap-2 py-0.5 font-mono text-xs">
                        <span class="opacity-60">{rule.matchType}</span>
                        <span class="break-all">{rule.pattern}</span>
                    </div>
                {:else}
                    <p class="text-xs opacity-60">None</p>
                {/each}
            </div>
        {/each}
    </div>
</div>
