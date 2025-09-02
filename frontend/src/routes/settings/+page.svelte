<script>
    import { Pencil, X } from "lucide-svelte";
    import {CreateWaypoint, DeleteWaypoint, SetFlag, ToggleFlag } from "../../lib/wailsjs/go/main/App";
    import { marasiConfig, populateWaypoints, waypoints, syntaxMode } from "../../stores";
    import { SlideToggle } from '@skeletonlabs/skeleton';

    let targetHost = "";
    let override = "";
    let selected = "";

</script>

<div class="no-select p-4 space-y-2">
    <h2 class="text-2xl font-bold mb-6">Marasi Settings</h2>
    <SlideToggle name="slider-label" active="bg-primary-500" on:change={(event) => {
        ToggleFlag("vim_enabled").then((config) => {
            marasiConfig.set(config);
        })
    }} bind:checked={$marasiConfig.VimEnabled}>Vim Enabled</SlideToggle>
    <label class="label">
        <span>Syntax Mode:</span>
        <div class="space-y-2">
           	<label class="flex items-center space-x-2">
          		<input class="radio" type="radio" name="radio-direct" value="disabled" bind:group={$syntaxMode}/>
          		<p>Disabled</p>
           	</label>
           	<label class="flex items-center space-x-2">
          		<input class="radio" type="radio" name="radio-direct" value="auto" bind:group={$syntaxMode}/>
          		<p>Auto</p>
           	</label>
           	<label class="flex items-center space-x-2">
          		<input class="radio" type="radio" name="radio-direct" value="enabled" bind:group={$syntaxMode}/>
          		<p>Enabled</p>
           	</label>
        </div>
    </label>
    <label class="label">
        <span>Default Interface</span>
        <input on:change={(event) => {
            console.log(event.target.value);
            SetFlag("default_address", event?.target?.value).then((config) => {
                marasiConfig.set(config);
            });
        }} bind:value={$marasiConfig.DefaultAddress} class="input" title="Input (text)" type="text" placeholder="Listener" />
    </label>
    <label class="label">
        <span>Default Port</span>
        <input
            on:change={(event) => {
                SetFlag("default_port", event?.target?.value).then((config) => {
                    marasiConfig.set(config);
                });
            }}
            bind:value={$marasiConfig.DefaultPort} class="input" title="Input (text)" type="text" placeholder="Listener" />
    </label>
    <label class="label">
        <span>Waypoints</span>
        <div class="table-container">
            <table class="table table-hover">
                <thead>
                    <tr>
                        <th class="text-center">Host</th>
                        <th class="text-center">Override</th>
                        <th class="bg-primar-500"></th>
                    </tr>
                    <tr>
                        <td >
                            <input type="text" placeholder="Enter host (host:port)" class="input w-full variant-filled-secondary" bind:value={targetHost}/>
                        </td>
                        <td >
                            <input type="text" placeholder="Enter override (host:port)" class="input w-full variant-filled-secondary" bind:value={override}/>
                        </td>
                        <td >
                            <button disabled={targetHost === "" || override === "" || (targetHost in $waypoints && selected !== targetHost)} type="button" class="btn variant-filled-primary block mx-auto w-full" on:click={() => {
                                CreateWaypoint(targetHost, override).then(() => {
                                    console.log("Addedd");
                                    targetHost = "";
                                    override = "";
                                    selected = "";
                                    populateWaypoints();
                                }).catch((waypointErr) => {
                                    console.log(waypointErr);
                                })
                            }}>{#if selected === targetHost && targetHost !== ""}Update Waypoint{:else}Add Waypoint{/if}</button>
                        </td>
                    </tr>
                </thead>
                <tbody>
                    {#each Object.keys($waypoints) as host}
                        <tr>
                            <td>{host}</td>
                            <td>{$waypoints[host]}</td>
                            <td class="text-center">
                                <div class="flex justify-center items-center space-x-2">
                                    <button on:click={() => {
                                        DeleteWaypoint(host)
                                            .then(() => { populateWaypoints(); })
                                            .catch((deleteError) => { console.log(deleteError); })
                                    }} type="button" class="btn-icon variant-filled-primary inline-flex items-center justify-center p-1 w-auto h-auto">
                                        <X size={15}/>
                                    </button>
                                    <button on:click={() => {
                                        selected = host;
                                        targetHost = host;
                                        override = $waypoints[host];
                                    }} type="button" class="btn-icon variant-filled-primary inline-flex items-center justify-center p-1 w-auto h-auto">
                                        <Pencil size={15}/>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        {/each}
                </tbody>
            </table>
        </div>
</div>
