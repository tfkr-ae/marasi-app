<script>
    import { Stepper, Step, getModalStore} from '@skeletonlabs/skeleton';
    import { ToggleFlag } from '../wailsjs/go/main/App';
    import { marasiConfig } from '../../stores';
    const modalStore = getModalStore();
</script>


{#if $modalStore[0]}
    <div class="card p-4 w-modal shadow-xl space-y-4 rounded-0">
        <Stepper active="variant-filled-primary" on:complete={(event) => {
            ToggleFlag("first_run").then((config) => {
                marasiConfig.set(config);
            }).catch((toggleError) => {
                console.log(toggleError);
            })
            modalStore.close();
        }}>
            <Step>
                <svelte:fragment slot="header">Welcome to Marasi!</svelte:fragment>
                <p>Let us get started with some basic concepts</p>
                <!-- <p>You can press <kbd class="kbd">⌘ + ?</kbd> at any time to access this guide</p> -->
                <p>You can press <kbd class="kbd">⌘ + K</kbd> at any time to open the command menu</p>
            </Step>
            <Step>
                <svelte:fragment slot="header">Startup</svelte:fragment>
                <div class="step-content space-y-4" style="max-height: 70vh; overflow-y: auto;">
                    <p>Whenever you open Marasi it will automatically do two things:</p>
                    <ol class="list">
                        <li><span>1.</span><span class="flex-auto">Open the scratchpad project</span></li>
                        <li><span>2.</span><span class="flex-auto">Configure the default listener on <code class="code">127.0.0.1:8080</code></span></li>
                    </ol>
                    <p>Think of the scratchpad as a not quite temporary, temporary project file!</p>
                    <p>You can press <kbd class="kbd">⌘ + O</kbd> at any point, or click on the Open Project button to switch to another project</p>
                    <img src="/project.gif"/>
                    <hr>
                    <p>You can press <kbd class="kbd">⌘ + L</kbd> at any point, or click on the listener button to reconfigure your listener </p>
                    <p>The indicator on the button will let you know if the listener is active</p>
                    <img src="/listener.gif"/>
                </div>
            </Step>
            <Step>
                <svelte:fragment slot="header">Proxying Traffic Through Marasi</svelte:fragment>
                <p>Marasi supports both forward proxy configurations as well as transparent proxies</p>
                <p>Once the proxy is configured on an application / device, navigate to <code class="code">marasi/cert</code> to download your certificate</p>
                <p>Otherwise you can get it from your config directory</p>
                <p>If you have Chrome instaled, you can press<kbd class="kbd">⌘ + `</kbd> at any point to open a preconfigured Chrome profile that will whitelist your certificate</p>
            </Step>
            <Step>
                <svelte:fragment slot="header">Marasi Features</svelte:fragment>
                <div class="step-content space-y-4" style="max-height: 70vh; overflow-y: auto;">
                    <h4 class="h4">Dashboard</h4>
                    <p>Here you can view high level details on your current project and also any application / extension logs</p>
                    <img src="/dashboard.webp"/>
                    <h4 class="h4">Ledger</h4>
                    <p>The <code class="code">Ledger</code> is where you will be able to see all the requests and responses that have went through <code class="code">Marasi</code></p>
                    <p>You will be able to highlight, take notes and interact with each request and response</p>
                    <img src="/ledger.gif"/>
                    <h4 class="h4">Compass</h4>
                    <p>The <code class="code">Compass</code> is where you will define your scope. You will be able to filter requests and responses out using Lua</p>
                    <h4 class="h4">Checkpoint</h4>
                    <p>With <code class="code">Checkpoint</code> you will be able to define interception rules to hold requests and responses in <code class="code">Marasi</code></p>
                    <h4 class="h4">Launchpad</h4>
                    <p><code class="code">Launchpad</code> is where you will be able to group, edit and resend requests through <code class="code">Marasi</code></p>
                    <h4 class="h4">Workshop</h4>
                    <p>The <code class="code">Workshop</code> is where you will be extending and scripting <code class="code">Marasi</code>. You will be able to process and send requests and responses with Lua</p>
                </div>
            </Step>
        </Stepper>
    </div>
{/if}