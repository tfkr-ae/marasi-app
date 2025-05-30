<script>
    import { onMount } from "svelte";
    import { activeProject, proxyItems } from "../../stores";
    import { CountNotes, GetScopeRules } from "../wailsjs/go/main/App";
    import { 
        Edit2Icon, 
        SendIcon, 
        FlagIcon,
        ActivityIcon,
        CheckCircleIcon,
        XCircleIcon
    } from "svelte-feather-icons";
    import { Shield, ShieldOff } from "lucide-svelte";
    
    // Dashboard statistics
    let totalRequests = 0;
    let notes = 0;
    let launchpads = 0;
    let intercepted = 0;
    
    // Scope statistics
    let defaultAllow = true;
    let includeRulesCount = 0;
    let excludeRulesCount = 0;
    
    // Calculate total requests reactively
    $: totalRequests = Object.values($proxyItems).length;

    $: if ($activeProject) {
        console.log("Active");
        refreshDashboard();
    }
    
    // Refresh dashboard data
    function refreshDashboard() {
        CountNotes().then((dashboard) => {
            console.log(dashboard)
            notes = dashboard.Notes;
            launchpads = dashboard.Launchpads;
            intercepted = dashboard.Interceptions || 0;
        });
        
        GetScopeRules().then((scopeData) => {
            console.log(scopeData)
            defaultAllow = scopeData.defaultAllow;
            includeRulesCount = scopeData.includeRules.length;
            excludeRulesCount = scopeData.excludeRules.length;
        });
    }
    
    // Initialize dashboard
    onMount(() => {
        refreshDashboard();
    });
</script>

<div class="no-select p-4">
    <h2 class="text-2xl font-bold mb-6">{$activeProject} Project Dashboard</h2>
    
    <!-- Main metrics cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <!-- Total Requests -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-primary-700)); color: rgb(var(--color-primary-200))">
                        <ActivityIcon size="24" />
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Total Requests</p>
                        <p class="text-3xl font-bold">{totalRequests}</p>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Notes -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-tertiary-700)); color: rgb(var(--color-tertiary-200))">
                        <Edit2Icon size="24" />
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Notes</p>
                        <p class="text-3xl font-bold">{notes}</p>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Launchpads -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-surface-700)); color: rgb(var(--color-surface-300))">
                        <SendIcon size="24" />
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Launchpads</p>
                        <p class="text-3xl font-bold">{launchpads}</p>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Intercepted -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-warning-700)); color: rgb(var(--color-warning-200))">
                        <FlagIcon size="24" />
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Intercepted</p>
                        <p class="text-3xl font-bold">{intercepted}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Scope metrics cards -->
    <h2 class="text-2xl font-bold mb-6">{$activeProject} Project Scope</h2>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Default Policy -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-success-700)); color: rgb(var(--color-success-200))">
                        {#if !defaultAllow}
                            <Shield size="24" />
                        {:else}
                            <ShieldOff size="24" />
                        {/if}
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Default Policy</p>
                        <p class="text-3xl font-bold">{defaultAllow ? 'Allow' : 'Deny'}</p>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Include Rules -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-secondary-700)); color: rgb(var(--color-surface-800))">
                        <CheckCircleIcon size="24" />
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Include Rules</p>
                        <p class="text-3xl font-bold">{includeRulesCount}</p>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Exclude Rules -->
        <div class="card bg-base-200 shadow-lg">
            <div class="card-body p-4">
                <div class="flex items-center">
                    <div class="rounded-full p-3" style="background-color: rgb(var(--color-error-700)); color: rgb(var(--color-error-200))">
                        <XCircleIcon size="24" />
                    </div>
                    <div class="ml-4">
                        <p class="text-sm opacity-70">Exclude Rules</p>
                        <p class="text-3xl font-bold">{excludeRulesCount}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
  .card {
    background-color: rgb(var(--color-surface-500));
    color: white;
  }
</style>