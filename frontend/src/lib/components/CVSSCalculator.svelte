<script>
    import { createEventDispatcher } from "svelte";
    import { CVSS31 } from "@pandatix/js-cvss";

    const dispatch = createEventDispatcher();

    export let vector = "";
    export let score = null;

    let selections = {
        AV: "N",
        AC: "L",
        PR: "N",
        UI: "N",
        S: "U",
        C: "H",
        I: "H",
        A: "H",
    };

    const leftMetrics = [
        {
            name: "Attack Vector (AV)",
            key: "AV",
            options: [
                { L: "Network", v: "N" },
                { L: "Adjacent", v: "A" },
                { L: "Local", v: "L" },
                { L: "Physical", v: "P" },
            ],
        },
        {
            name: "Attack Complexity (AC)",
            key: "AC",
            options: [
                { L: "Low", v: "L" },
                { L: "High", v: "H" },
            ],
        },
        {
            name: "Privileges Required (PR)",
            key: "PR",
            options: [
                { L: "None", v: "N" },
                { L: "Low", v: "L" },
                { L: "High", v: "H" },
            ],
        },
        {
            name: "User Interaction (UI)",
            key: "UI",
            options: [
                { L: "None", v: "N" },
                { L: "Required", v: "R" },
            ],
        },
    ];

    const rightMetrics = [
        {
            name: "Scope (S)",
            key: "S",
            options: [
                { L: "Unchanged", v: "U" },
                { L: "Changed", v: "C" },
            ],
        },
        {
            name: "Confidentiality (C)",
            key: "C",
            options: [
                { L: "None", v: "N" },
                { L: "Low", v: "L" },
                { L: "High", v: "H" },
            ],
        },
        {
            name: "Integrity (I)",
            key: "I",
            options: [
                { L: "None", v: "N" },
                { L: "Low", v: "L" },
                { L: "High", v: "H" },
            ],
        },
        {
            name: "Availability (A)",
            key: "A",
            options: [
                { L: "None", v: "N" },
                { L: "Low", v: "L" },
                { L: "High", v: "H" },
            ],
        },
    ];

    $: {
        if (vector && vector.includes("CVSS:3.1")) {
            try {
                const parsed = new CVSS31(vector);

                if (parsed && parsed._metrics) {
                    const m = parsed._metrics;
                    selections = {
                        AV: m.AV || "N",
                        AC: m.AC || "L",
                        PR: m.PR || "N",
                        UI: m.UI || "N",
                        S: m.S || "U",
                        C: m.C || "H",
                        I: m.I || "H",
                        A: m.A || "H",
                    };
                }

                const calculatedScore = parsed.BaseScore();
                score = isNaN(calculatedScore) ? null : calculatedScore;
            } catch (err) {
                score = null;
            }
        } else {
            score = null;
        }
    }

    function handleSelection(key, val) {
        selections[key] = val;
        vector = `CVSS:3.1/AV:${selections.AV}/AC:${selections.AC}/PR:${selections.PR}/UI:${selections.UI}/S:${selections.S}/C:${selections.C}/I:${selections.I}/A:${selections.A}`;
        dispatch("update", { vector, score });
    }
</script>

<div class="card overflow-hidden border border-surface-500/30">
    <header
        class="bg-surface-700 p-2 px-4 flex justify-between items-center text-white"
    >
        <span
            class="text-sm font-bold uppercase tracking-widest text-primary-400"
            >Base Score Metrics</span
        >
        <code class="text-xs variant-soft-primary p-1 rounded font-mono">
            {vector || "No vector set"}
        </code>
    </header>

    <div
        class="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 bg-surface-50/5 w-full"
    >
        <div class="space-y-6 w-full">
            {#each leftMetrics as m}
                <div class="space-y-2">
                    <p class="font-bold text-sm opacity-80 text-secondary-500">
                        {m.name}
                    </p>
                    <div class="flex flex-wrap gap-2 w-full">
                        {#each m.options as opt}
                            <button
                                type="button"
                                class="btn btn-sm grow transition-colors {selections[
                                    m.key
                                ] === opt.v
                                    ? 'variant-filled-primary'
                                    : 'variant-soft-surface'}"
                                on:click={() => handleSelection(m.key, opt.v)}
                            >
                                {opt.L} ({opt.v})
                            </button>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>

        <div class="space-y-6 w-full">
            {#each rightMetrics as m}
                <div class="space-y-2">
                    <p class="font-bold text-sm opacity-80 text-secondary-500">
                        {m.name}
                    </p>
                    <div class="flex flex-wrap gap-2 w-full">
                        {#each m.options as opt}
                            <button
                                type="button"
                                class="btn btn-sm grow transition-colors {selections[
                                    m.key
                                ] === opt.v
                                    ? 'variant-filled-primary'
                                    : 'variant-soft-surface'}"
                                on:click={() => handleSelection(m.key, opt.v)}
                            >
                                {opt.L} ({opt.v})
                            </button>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    </div>

    <footer class="p-4 border-t border-surface-500/20 bg-surface-800/30">
        <label class="label">
            <span class="text-xs opacity-60 mb-1 block uppercase font-bold"
                >Manual Vector Override / Paste</span
            >
            <input
                class="input font-mono text-sm variant-form-material"
                type="text"
                bind:value={vector}
                placeholder="e.g. CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
            />
        </label>
    </footer>
</div>
