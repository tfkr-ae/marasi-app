<script>
    import { goto } from "$app/navigation";
    import {
        LoadExtensions,
        OpenProject,
        StartBrowser,
        StartProxy,
        ToggleFlag,
        ToggleIntercept,
    } from "../lib/wailsjs/go/main/App";
    import { ChromeIcon, ToolIcon } from "svelte-feather-icons";
    import LogTable from "../lib/components/LogTable.svelte";
    import Dashboard from "../lib/components/Dashboard.svelte";
    import {
        getDrawerStore,
        getModalStore,
        getToastStore,
    } from "@skeletonlabs/skeleton";
    import MarasiKeys from "../lib/components/MarasiMenu/MarasiKeys.svelte";
    import {
        AnchorIcon,
        Binoculars,
        BookIcon,
        CompassIcon,
        FlagIcon,
        FolderOpen,
        PartyPopper,
        SendIcon,
        Settings,
        ToggleLeft,
    } from "lucide-svelte";
    import {
        activeProject,
        listener,
        marasiConfig,
        openProject,
        interceptFlag,
    } from "../stores";
    import { WindowSetTitle } from "../lib/wailsjs/runtime/runtime";
    const drawerStore = getDrawerStore();
    const modalStore = getModalStore();
    const toastStore = getToastStore();

    function closeAndGoto(url) {
        drawerStore.close();
        modalStore.close();
        document.querySelector("dialog")?.close();
        goto(url);
    }
    function setupListener(r) {
        StartProxy(r.addr, r.port)
            .then(() => {
                listener.set({
                    status: true,
                    address: r.addr,
                    port: r.port,
                });
                const toastSettings = {
                    message: "Listening on " + r.addr + ":" + r.port,
                    background: "variant-filled-success",
                };
                toastStore.trigger(toastSettings);
            })
            .catch((listenerError) => {
                listener.set({
                    status: false,
                    address: r.addr,
                    port: r.port,
                });
                const toastSettings = {
                    message:
                        "Failed to setup listener on " + r.addr + ":" + r.port,
                    background: "variant-filled-error",
                };
                toastStore.trigger(toastSettings);
            });
    }

    function open(r) {
        OpenProject(r)
            .then((name) => {
                LoadExtensions()
                    .then(() => {
                        activeProject.set(name);
                        WindowSetTitle(name);
                        openProject();
                        const toastSettings = {
                            message: "Opened " + name + " project",
                            background: "variant-filled-success",
                        };
                        toastStore.trigger(toastSettings);
                    })
                    .catch((extensionError) => {
                        const toastSettings = {
                            message: "Failed to open project",
                            background: "variant-filled-error",
                        };
                        toastStore.trigger(toastSettings);
                    });
            })
            .catch((repoError) => {
                alert(repoError);
            });
    }
</script>

<div class="content">
    <div class="no-select dashboard-content">
        <MarasiKeys
            scope="all"
            menuOptions={[
                {
                    name: "Marasi",
                    subtitle: "Dashboard",
                    icon: AnchorIcon,
                    keywords: "home, dashboard",
                    action: {
                        handler: () => {
                            closeAndGoto("/");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+1", "ctrl+1"],
                    },
                },
                {
                    name: "Ledger",
                    action: {
                        handler: () => {
                            closeAndGoto("/ledger");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+2", "ctrl+2"],
                    },
                    subtitle: "View requests",
                    icon: BookIcon,
                    keywords: "ledger",
                },
                {
                    name: "Compass",
                    action: {
                        handler: () => {
                            closeAndGoto("/compass");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+3", "ctrl+3"],
                    },
                    subtitle: "Configure scope",
                    icon: CompassIcon,
                    keywords: "compass",
                },
                {
                    name: "Checkpoint",
                    action: {
                        handler: () => {
                            closeAndGoto("/checkpoint");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+4", "ctrl+4"],
                    },
                    subtitle: "Intercept Requests",
                    icon: FlagIcon,
                    keywords: "checkpoint",
                },
                {
                    name: "Launchpad",
                    action: {
                        handler: () => {
                            closeAndGoto("/launchpad");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+5", "ctrl+5"],
                    },
                    subtitle: "Edit and Repeat Requests",
                    icon: SendIcon,
                    keywords: "Launchpad",
                },
                {
                    name: "Workshop",
                    action: {
                        handler: () => {
                            closeAndGoto("/workshop");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+6", "ctrl+6"],
                    },
                    subtitle: "Extend Marasi",
                    icon: ToolIcon,
                    keywords: "Workshop",
                },
                {
                    name: "Settings",
                    action: {
                        handler: () => {
                            closeAndGoto("/settings");
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+S", "ctrl+S"],
                    },
                    subtitle: "Configure your settings",
                    icon: Settings,
                    keywords: "settings",
                },
                {
                    name: "Start Chrome",
                    action: {
                        handler: () => {
                            StartBrowser().then(() => {
                                console.log("Chrome started");
                            });
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+`", "ctrl+`"],
                    },
                    subtitle: "Start Browser",
                    icon: ChromeIcon,
                    keywords: "Chrome",
                },
                {
                    name: "Jump to Toast",
                    action: {
                        handler: () => {
                            drawerStore.close();
                            modalStore.close();
                            document.querySelector("dialog")?.close();
                            $toastStore[0]?.action?.response();
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+.", "ctrl+."],
                    },
                    subtitle: "Jump to the active toast",
                    icon: PartyPopper,
                    keywords: "toast",
                },
                {
                    name: "Open Project",
                    action: {
                        handler: () => {
                            const modal = {
                                type: "component",
                                component: "Project",
                                title: "Switch Projects",
                                response: (r) => {
                                    if (r) {
                                        open(r);
                                    }
                                },
                            };
                            if (!$modalStore[0]) {
                                modalStore.trigger(modal);
                            } else if ($modalStore[0].component === "Project") {
                                modalStore.close();
                            }
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+O", "ctrl+O"],
                    },
                    subtitle: "Open a project",
                    icon: FolderOpen,
                    keywords: "open project",
                },
                {
                    name: "Setup Listener",
                    action: {
                        handler: () => {
                            const modal = {
                                type: "component",
                                component: "Interface",
                                title: "Setup Listener",
                                response: (r) => {
                                    if (r) {
                                        setupListener(r);
                                    }
                                },
                            };
                            if (!$modalStore[0]) {
                                modalStore.trigger(modal);
                            } else if (
                                $modalStore[0].component === "Interface"
                            ) {
                                modalStore.close();
                            }
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+L", "ctrl+L"],
                    },
                    subtitle: "Start a new listener",
                    icon: Binoculars,
                    keywords: "listener",
                },
                {
                    name: "Toggle Vim Mode",
                    action: {
                        handler: () => {
                            // $marasiConfig.VimEnabled = !$marasiConfig.VimEnabled;
                            ToggleFlag("vim_enabled").then((config) => {
                                marasiConfig.set(config);
                            });
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+T", "ctrl+T"],
                    },
                    subtitle: "Toggle Vim Mode in editor views",
                    icon: ToggleLeft,
                    keywords: "vim",
                },
                {
                    name: $interceptFlag
                        ? "Toggle Intercept Off"
                        : "Toggle Intercept On",
                    action: {
                        handler: () => {
                            ToggleIntercept().then((flag) => {
                                interceptFlag.set(flag);
                            });
                        },
                        options: { scope: "all", single: true },
                        keys: ["⌘+I", "ctrl+I"],
                    },
                    subtitle: "Toggle the Global Intercept On or Off",
                    icon: ToggleLeft,
                    keywords: "intercept, toggle, global",
                },
            ]}
        />
        <div class="container mx-auto p-8 space-y-8">
            <div class="header flex justify-between items-center mb-8">
                <div class="btn-group variant-filled">
                    <button
                        type="button"
                        class="btn items-center flex variant-filled"
                        on:click={() => {
                            const modal = {
                                type: "component",
                                component: "Interface",
                                title: "Setup Listener",
                                response: (r) => {
                                    if (r) {
                                        setupListener(r);
                                    }
                                },
                            };
                            if (!$modalStore[0]) {
                                modalStore.trigger(modal);
                            }
                        }}
                    >
                        <span>{$listener.address + ":" + $listener.port}</span>
                        <span
                            class={"flex w-3 h-3 me-3 rounded-full " +
                                ($listener.status
                                    ? "bg-success-500"
                                    : "bg-primary-500")}
                        ></span>
                    </button>
                    <button
                        type="button"
                        class="btn variant-filled flex items-center"
                        on:click={() => {
                            const modal = {
                                type: "component",
                                component: "Project",
                                title: "Switch Projects",
                                response: (r) => {
                                    if (r) {
                                        open(r);
                                    }
                                },
                            };
                            if (!$modalStore[0]) {
                                modalStore.trigger(modal);
                            }
                        }}
                    >
                        <span class="mr-2"><FolderOpen /></span>
                        <span>Open Project</span>
                    </button>
                </div>
                <button
                    type="button"
                    class="btn variant-filled-primary"
                    on:click={StartBrowser}
                >
                    <span class=""><ChromeIcon /></span>
                    <span>Start Chrome</span>
                </button>
            </div>
            <Dashboard />
        </div>
    </div>

    <div class="log-table-container">
        <LogTable />
    </div>
</div>

<style>
    /* Container for the page content */
    .content {
        display: flex;
        flex-direction: column;
        height: 100vh; /* Use fixed height instead of min-height */
        overflow: hidden; /* Prevent overall page scrolling */
        position: relative; /* Create positioning context */
    }

    /* Main content area - fixed, non-scrollable */
    .dashboard-content {
        flex: 1 0 auto;
        overflow-y: hidden; /* Prevent dashboard content from scrolling */
        max-height: calc(
            100vh - 30vh
        ); /* Ensure it doesn't overflow available space */
        padding-bottom: 1rem;
    }

    /* Log table container - the only scrollable part */
    .log-table-container {
        flex: 0 0 50vh; /* Fixed height */
        height: 50vh;
        border-top: 2px solid #2f343c;
        background-color: #1c1c1c;
        overflow-y: auto; /* Enable scrolling only for log table */
        position: relative; /* Create stacking context */
        bottom: 0; /* Position at bottom */
        width: 100%;
    }

    /* Responsive adjustments for small screens */
    @media (max-height: 700px) {
        .dashboard-content {
            max-height: calc(100vh - 25vh);
        }

        .log-table-container {
            flex: 0 0 25vh;
            height: 25vh;
        }
    }

    @media (max-height: 500px) {
        .dashboard-content {
            max-height: calc(100vh - 20vh);
        }

        .log-table-container {
            flex: 0 0 20vh;
            height: 20vh;
        }
    }
</style>
