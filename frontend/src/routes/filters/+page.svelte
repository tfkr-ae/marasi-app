<script>
    import {
        requestFilters,
        upsertRequestFilter,
        deleteRequestFilter,
        resetRequestFilters,
    } from "../../stores";
    import { compileHttpql } from "../../lib/utils/httpql";
    import { getToastStore } from "@skeletonlabs/skeleton";
    import { Check, FilePlus2, RefreshCcw, Trash2 } from "lucide-svelte";

    const toastStore = getToastStore();

    const templates = [
        {
            name: "Base64 URL Hunter",
            description:
                "Highlights when request or response bodies leak base64 URLs.",
            expression:
                "hasBase64Url(request.body) OR hasBase64Url(response.body)",
            defaultAction: "highlight",
            color: "#f97316",
        },
        {
            name: "Reflection Detector",
            description:
                "Keeps only rows where params or cookies reflect in responses.",
            expression:
                "reflects(request.params, response.body) OR reflects(request.cookies, response.body)",
            defaultAction: "include",
            color: "#84cc16",
        },
        {
            name: "Server Error JSON",
            description: "Finds JSON responses with status >= 500.",
            expression:
                "response.status >= 500 AND response.contenttype : json",
            defaultAction: "include",
            color: "#f87171",
        },
    ];

    const emptyForm = () => ({
        id: null,
        name: "",
        description: "",
        expression: "",
        defaultAction: "highlight",
        color: "#6366f1",
    });

    let form = emptyForm();
    let validationError = "";

    $: validationError = validateExpression(form.expression);

    function validateExpression(expression) {
        if (!expression?.trim()) {
            return "Enter an HTTPQL expression";
        }
        const compiled = compileHttpql(expression);
        return compiled.error ? compiled.error.message : "";
    }

    function startEdit(filter) {
        form = { ...filter };
    }

    function resetForm() {
        form = emptyForm();
    }

    function applyTemplate(template) {
        form = {
            ...form,
            name: template.name,
            description: template.description,
            expression: template.expression,
            defaultAction: template.defaultAction,
            color: template.color,
            id: null,
        };
    }

    function saveFilter() {
        if (!form.name.trim()) {
            validationError = "Name is required";
            return;
        }
        if (validationError) return;
        const saved = upsertRequestFilter(form);
        toastStore.trigger({
            message: `${saved.name} saved`,
            background: "variant-filled-success",
        });
        resetForm();
    }

    function removeFilter(id) {
        deleteRequestFilter(id);
        if (form.id === id) {
            resetForm();
        }
        toastStore.trigger({
            message: "Filter deleted",
            background: "variant-filled-error",
        });
    }

    function restoreDefaults() {
        resetRequestFilters();
        toastStore.trigger({
            message: "Restored default filters",
            background: "variant-filled-warning",
        });
        resetForm();
    }
</script>

<svelte:head>
    <title>Filter Builder</title>
</svelte:head>

<section class="filters-page">
    <header class="page-header">
        <div>
            <h1>HTTPQL Filters</h1>
            <p>Create reusable filters for the Requests tab.</p>
        </div>
        <button class="ghost" on:click={restoreDefaults}>
            <RefreshCcw size={16} />
            Restore defaults
        </button>
    </header>
    <div class="layout">
        <aside class="library">
            <h2>Saved Filters ({$requestFilters.length})</h2>
            {#if $requestFilters.length === 0}
                <p class="hint">
                    Nothing here yet. Use the builder to add one.
                </p>
            {:else}
                <ul>
                    {#each $requestFilters as filter}
                        <li class={filter.id === form.id ? "active" : ""}>
                            <button on:click={() => startEdit(filter)}>
                                <span>
                                    <strong>{filter.name}</strong>
                                    <small>{filter.description}</small>
                                </span>
                                <span class="actions">
                                    <span
                                        class="pill"
                                        style={`background:${filter.color}`}
                                    ></span>
                                    <button
                                        type="button"
                                        class="ghost danger"
                                        on:click={(event) => {
                                            event.stopPropagation();
                                            removeFilter(filter.id);
                                        }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
            <div class="templates">
                <h3>Templates</h3>
                {#each templates as template}
                    <button
                        type="button"
                        on:click={() => applyTemplate(template)}
                    >
                        <FilePlus2 size={14} />
                        <span>
                            <strong>{template.name}</strong>
                            <small>{template.description}</small>
                        </span>
                    </button>
                {/each}
            </div>
        </aside>
        <form class="builder" on:submit|preventDefault={saveFilter}>
            <h2>{form.id ? "Edit Filter" : "New Filter"}</h2>
            <label>
                Name
                <input
                    type="text"
                    bind:value={form.name}
                    placeholder="e.g. JSON errors"
                />
            </label>
            <label>
                Description
                <textarea
                    rows="2"
                    bind:value={form.description}
                    placeholder="What does this filter do?"
                ></textarea>
            </label>
            <label>
                HTTPQL Expression
                <textarea
                    rows="5"
                    bind:value={form.expression}
                    placeholder="request.method = POST AND response.status >= 400"
                ></textarea>
            </label>
            {#if form.expression}
                <p class={validationError ? "error" : "hint"}>
                    {validationError
                        ? validationError
                        : "Expression looks valid. Available helpers: hasBase64Url(), reflects()"}
                </p>
            {/if}
            <label>
                Behaviour
                <select bind:value={form.defaultAction}>
                    <option value="highlight">Highlight matches</option>
                    <option value="include">Only show matches</option>
                    <option value="exclude">Filter out matches</option>
                </select>
            </label>
            <label>
                Highlight color
                <input
                    type="color"
                    bind:value={form.color}
                    style="padding:4px;"
                />
            </label>
            <div class="builder-actions">
                <button type="submit" class="primary">
                    <Check size={16} />
                    Save filter
                </button>
                <button type="button" class="ghost" on:click={resetForm}>
                    Clear form
                </button>
            </div>
        </form>
    </div>
</section>

<style>
    .filters-page {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .page-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
    }

    .page-header h1 {
        font-size: 1.5rem;
        margin: 0;
    }

    .layout {
        display: grid;
        grid-template-columns: minmax(280px, 1fr) 2fr;
        gap: 1.5rem;
    }

    .library {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 1rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .library ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .library li button {
        width: 100%;
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.75rem;
        padding: 0.6rem;
        background: rgba(255, 255, 255, 0.02);
        cursor: pointer;
        text-align: left;
    }

    .library li.active button {
        border-color: #60a5fa;
        box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.3);
    }

    .library small {
        display: block;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.7);
    }

    .library .pill {
        width: 16px;
        height: 16px;
        border-radius: 999px;
    }

    .library .actions {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .templates button {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 0.75rem;
        padding: 0.6rem;
        background: transparent;
        cursor: pointer;
    }

    .builder {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 1rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        background: rgba(0, 0, 0, 0.2);
    }

    .builder label {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .builder input,
    .builder textarea,
    .builder select {
        border-radius: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.02);
        color: inherit;
    }

    .builder-actions {
        display: flex;
        gap: 0.6rem;
    }

    button.primary {
        background: #2563eb;
        border: none;
        border-radius: 0.75rem;
        padding: 0.5rem 1rem;
        color: white;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        cursor: pointer;
    }

    button.ghost {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: transparent;
        border-radius: 0.75rem;
        padding: 0.4rem 0.8rem;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        cursor: pointer;
    }

    button.ghost.danger {
        border-color: rgba(248, 113, 113, 0.5);
        color: #f87171;
    }

    .hint {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.6);
    }

    .error {
        font-size: 0.85rem;
        color: #f87171;
    }

    @media (max-width: 900px) {
        .layout {
            grid-template-columns: 1fr;
        }
    }
</style>
