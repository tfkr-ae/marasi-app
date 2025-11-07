<script>
    import Logo from "../lib/components/Logo.svelte";
    import {
        computePosition,
        autoUpdate,
        offset,
        shift,
        flip,
        arrow,
    } from "@floating-ui/dom";
    import { storePopup } from "@skeletonlabs/skeleton";
    import {
        initializeStores,
        Toast,
        Modal,
        getToastStore,
        getModalStore,
    } from "@skeletonlabs/skeleton";
    initializeStores();
    import { onMount } from "svelte";
    import { autoModeWatcher } from "@skeletonlabs/skeleton";
    import { AppRail, AppRailAnchor } from "@skeletonlabs/skeleton";
    import {
        BookIcon,
        SettingsIcon,
        SendIcon,
        ToolIcon,
        FlagIcon,
        CompassIcon,
        ZapIcon,
    } from "svelte-feather-icons";
    import { goto } from "$app/navigation";
    import "../app.css";
    let currentTile = 0;
    import { page } from "$app/stores";
    import {
        proxyItems,
        logItems,
        activeProject,
        listener,
        openProject,
        readConfig,
        marasiConfig,
    } from "../stores.js";
    import { EventsOn, EventsOff, Quit, WindowSetTitle} from "../lib/wailsjs/runtime/runtime";
    import AppDrawer from "../lib/components/AppDrawer.svelte";
    import NotesModal from "../lib/components/NotesModal.svelte";
    import {
        GetExtensionFlag,
        GetExtensions,
        LoadExtensions,
        SetupScratchpad,
        StartProxy,
    } from "../lib/wailsjs/go/main/App";
    import WebComponentWrapper from "../lib/components/WebComponentWrapper.svelte";
    import { ChefHat, Brush} from "lucide-svelte";
    import MenuModal from "../lib/components/MenuModal.svelte";
    import MetadataModal from "../lib/components/MetadataModal.svelte";
    import InterfaceModal from "../lib/components/InterfaceModal.svelte";
    import ProjectModal from "../lib/components/ProjectModal.svelte";
    import StartupStepper from "../lib/components/StartupStepper.svelte";
    let extensions = {};
    let appRailIndex = 0;
    let showChef = false;
    let showExcali = false;
    let showInteract = false;
    let startupCompleted = false;

    // Lazy-loaded components
    let SvelteChef;
    let Excalidraw;
    let Interact;

    // Dynamic imports for heavy components
    const loadSvelteChef = async () => {
        if (!SvelteChef) {
            const module = await import("../lib/components/SvelteChef.svelte");
            SvelteChef = module.default;
        }
    };

    const loadExcalidraw = async () => {
        if (!Excalidraw) {
            const module = await import("../lib/components/Excalidraw.svelte");
            Excalidraw = module.default;
        }
    };

    const loadInteract = async () => {
        if (!Interact) {
            const module = await import("../lib/components/Interact.svelte");
            Interact = module.default;
        }
    };
    const toastStore = getToastStore();
    const modalStore = getModalStore();
    storePopup.set({ computePosition, autoUpdate, offset, shift, flip, arrow });
    const modalRegistery = {
        Startup: { ref: StartupStepper },
        Interface: {ref: InterfaceModal},
        Project: {ref: ProjectModal},
        Notes: { ref: NotesModal },
        MenuInput: { ref: MenuModal },
        Metadata: { ref: MetadataModal },
    };
    const StartupRoutine2 = new Promise((resolve) => {
        SetupScratchpad().then(() => {
            LoadExtensions().then(() => {
                StartProxy($marasiConfig.DefaultAddress, $marasiConfig.DefaultPort).then(() => {
                        listener.set({
                            status: true,
                            address: $marasiConfig.DefaultAddress,
                            port: $marasiConfig.DefaultPort
                        });
                        resolve();
                    }).catch((listenerError) => {
                        //Quit();
                        listener.set({
                            status: false,
                            address: $marasiConfig.DefaultAddress,
                            port: $marasiConfig.DefaultPort
                        });
                        resolve();
                    });
            }).catch((extensionError) => {
                    console.log(extensionError);
                    resolve();
            });
        }).catch((repoError) => {
            console.log(repoError);
            Quit();
        });
    })
    onMount(() => {
        autoModeWatcher();
        readConfig();
        StartupRoutine2.then(() => {
            WindowSetTitle("scratchpad");
            activeProject.set("scratchpad");
            openProject();
            console.log($marasiConfig)
            if ($marasiConfig.FirstRun) {
                const modal = {
                    type: "component",
                    component: "Startup",
                    title: "Setup Listener",
                    response: (r) => {
                        console.log(r);
                    }
                };
                if (!$modalStore[0]) {
                    modalStore.trigger(modal);
                }
            }
            hotkeys.filter = (event) => {
                if ($modalStore[0]?.component === "Startup") return false;
                if ($modalStore[0]?.component) return true;
                // if ($modalStore[0]?.component === "Interface" || $modalStore[0]?.component === "Project") return true;
                switch ($page.url.pathname) {
                    case "/ledger":
                        return true;
                    default:
                        var target = event.target || event.srcElement;
                        var tagName = target.tagName;
                        return (
                            !(
                                tagName == "INPUT" ||
                                tagName == "SELECT" ||
                                tagName == "TEXTAREA"
                            ) || target.id === "commandmenu"
                        );
                }
            };
            startupCompleted = true;
            //Function to handle events
            function handleNewLog(newLog) {
                $logItems = [...$logItems, newLog];
            }
            function handleNewRequest(newRequest) {
                console.log(newRequest);
                proxyItems.update((previous) => {
                    const item = {
                        Request: newRequest,
                        Response: {},
                        Metadata: newRequest.Metadata,
                    };
                    return { ...previous, [newRequest.ID]: item };
                });
            }
            function handleNewResponse(newResponse) {
                const item = $proxyItems[newResponse.ID]
                    ? $proxyItems[newResponse.ID]
                    : { Request: {} };
                item.Response = newResponse;
                item.Metadata = newResponse.Metadata;
                proxyItems.update((previous) => {
                    return { ...previous, [newResponse.ID]: item };
                });
            }
            let toastId = '';
            const toastSettings = {
                message: "Request Intercepted",
                action: {
                    label: "Jump to Checkpoint",
                    response: () => {
                        goto("/checkpoint")
                        toastStore.close(toastId);
                    },
                },
            };
            // Example of setting up an event listener
            EventsOn("request", (newRequest) => handleNewRequest(newRequest));
            EventsOn("response", (newResponse) =>
                handleNewResponse(newResponse),
            );
            EventsOn("log", (newLog) => {
                handleNewLog(newLog);
            });
            EventsOn("extension-toast", (message, background) => {
                console.log(message);
                console.log(background);
                const toast = {
                    message: message,
                    background: background,
                };
                toastStore.trigger(toast);
            })
            EventsOn("intercepted", (intercepted) => {
                console.log(intercepted);
                if ($page.url.pathname !== "/checkpoint") {
                    switch (intercepted) {
                        case "request":
                            toastId = toastStore.trigger(toastSettings);
                            break;
                        case "response":
                            toastSettings.message = "Response intercepted";
                            toastId = toastStore.trigger(toastSettings);
                            break;
                    }
                } else {
                    console.log("Already on intercept, not sending a toast");
                }
            });
            // Load extensons
            /* Probably will have to loop here to create all extensions */
            GetExtensions().then((exts) => {
                console.log(exts);
                Object.values(exts).forEach((extension) => {
                    GetExtensionFlag(extension["Name"], "ui").then(
                        (flag, error) => {
                            if (flag) {
                                extensions[extension["Name"]] = extension;
                            }
                        },
                    );
                });
            });
            // Cleanup function when the component is destroyed
        });
        return () => {
            EventsOff("request");
            EventsOff("response");
            EventsOff("intercepted");
            //ninjaMenu.clear();
        };
    });
</script>

<div class="flex flex-col h-screen">
    <div class="flex flex-1 h-screen">
        <Modal components={modalRegistery} />
        <Toast position="br" />
        {#if startupCompleted}
            <AppDrawer />
            <AppRail class="no-select h-full no-scroll">
                <!-- AppRailTiles -->
                <AppRailAnchor
                    selected={$page.url.pathname === "/"}
                    on:click={() => {
                        goto("/");
                    }}
                    bind:group={currentTile}
                    name="Home"
                    value={appRailIndex++}
                    title="Home"
                >
                    <svelte:fragment slot="lead">
                        <div
                            class="flex justify-center items-center w-full h-full"
                        >
                            {#if $page.url.pathname === "/"}
                                <Logo size="75" mode="light" />
                            {:else}
                                <Logo size="75" mode="dark" />
                            {/if}
                        </div>
                    </svelte:fragment>
                    <span></span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/ledger"}
                    on:click={() => {
                        goto("/ledger");
                    }}
                    bind:group={currentTile}
                    name="Ledger"
                    value={appRailIndex++}
                    title="Ledger"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <BookIcon />
                        </div>
                    </svelte:fragment>
                    <span>Ledger</span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/compass"}
                    on:click={() => {
                        goto("/compass");
                    }}
                    bind:group={currentTile}
                    name="Compass"
                    value={appRailIndex++}
                    title="Compass"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <CompassIcon />
                        </div>
                    </svelte:fragment>
                    <span>Compass</span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/checkpoint"}
                    on:click={() => {
                        goto("/checkpoint");
                    }}
                    bind:group={currentTile}
                    name="Checkpoint"
                    value={appRailIndex++}
                    title="Checkpoint"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <FlagIcon />
                        </div>
                    </svelte:fragment>
                    <span>Checkpoint</span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/launchpad"}
                    on:click={() => {
                        goto("/launchpad");
                    }}
                    bind:group={currentTile}
                    name="Launchpad"
                    value={appRailIndex++}
                    title="Launchpad"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <SendIcon />
                        </div>
                    </svelte:fragment>
                    <span>Launchpad</span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/workshop"}
                    on:click={() => {
                        goto("/workshop");
                    }}
                    bind:group={currentTile}
                    name="Workshop"
                    value={appRailIndex++}
                    title="Workshop"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <ToolIcon />
                        </div>
                    </svelte:fragment>
                    <span>Workshop</span>
                </AppRailAnchor>
            <!-- <AppRailAnchor selected={$page.url.pathname === '/extensions'} on:click={() => {goto("/extensions")}} bind:group={currentTile} name="Extensions" value={appRailIndex++} title="Extensions">
                <svelte:fragment slot="lead">
                    <div class="flex justify-center items-center w-full">
                        <ListIcon />
                    </div>
                </svelte:fragment>
                <span>Extensions</span>
            </AppRailAnchor> -->
                <AppRailAnchor
                    selected={$page.url.pathname === "/sveltechef"}
                    on:click={async () => {
                        await loadSvelteChef();
                        goto("/sveltechef");
                        showChef = true;
                    }}
                    bind:group={currentTile}
                    name="Chef"
                    value={appRailIndex++}
                    title="Chef"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <ChefHat />
                        </div>
                    </svelte:fragment>
                    <span>CyberChef</span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/excalidraw"}
                    on:click={async () => {
                        await loadExcalidraw();
                        goto("/excalidraw");
                        showExcali = true;
                    }}
                    bind:group={currentTile}
                    name="Excalidraw"
                    value={appRailIndex++}
                    title="Excalidraw"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <Brush />
                        </div>
                    </svelte:fragment>
                    <span>Excalidraw</span>
                </AppRailAnchor>
                <AppRailAnchor
                    selected={$page.url.pathname === "/interact"}
                    on:click={async () => {
                        await loadInteract();
                        goto("/interact");
                        showInteract = true;
                    }}
                    bind:group={currentTile}
                    name="InteractSh"
                    value={appRailIndex++}
                    title="InteractSh"
                >
                    <svelte:fragment slot="lead">
                        <div class="flex justify-center items-center w-full">
                            <ZapIcon />
                        </div>
                    </svelte:fragment>
                    <span>Interactsh</span>
                </AppRailAnchor>
                <hr class="!border-t-2" />
                {#each Object.entries(extensions) as [name, extension]}
                    <AppRailAnchor
                        selected={$page.url.pathname === "/extensions/" + name}
                        on:click={() => {
                            goto("/extensions/" + name);
                        }}
                        bind:group={currentTile}
                        {name}
                        value={appRailIndex++}
                        title={name}
                    >
                        <svelte:fragment slot="lead">
                            <div
                                class="flex justify-center items-center w-full"
                            >
                                <WebComponentWrapper
                                    extensionName={name}
                                    type="icon"
                                ></WebComponentWrapper>
                            </div>
                        </svelte:fragment>
                        <span>{name}</span>
                    </AppRailAnchor>
                {/each}
                <svelte:fragment slot="trail">
                    <AppRailAnchor
                        selected={$page.url.pathname === "/settings"}
                        on:click={() => {
                            goto("/settings");
                        }}
                        bind:group={currentTile}
                        name="Settings"
                        value={appRailIndex++}
                        title="Settings"
                    >
                        <div class="flex justify-center items-center w-full">
                            <SettingsIcon />
                        </div>
                    </AppRailAnchor>
                </svelte:fragment>
            </AppRail>

            <!-- Content area -->
            <div id="content" class="flex-1 overflow-auto">
                <slot />
                {#if SvelteChef && showChef}
                    <svelte:component this={SvelteChef} isVisible={showChef} />
                {/if}
                {#if Excalidraw && showExcali}
                    <svelte:component this={Excalidraw} isVisible={showExcali} />
                {/if}
                {#if Interact && showInteract}
                    <svelte:component this={Interact} isVisible={showInteract} />
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    :root {
        --ctx-menu-background: #2f343c;
        --ctx-menu-border: 1px solid #cf595b;
        --ctx-menu-hover-bg: #cf595b;
        --ctx-menu-font-size: 0.9rem;
        --ctx-menu-padding: 0.375rem 0.5rem;
    }

    .no-scroll {
        overflow: hidden; /* Hides the scrollbars */
        scrollbar-width: none; /* For Firefox */
        -ms-overflow-style: none; /* For Internet Explorer and Edge */
    }

    .no-scroll::-webkit-scrollbar {
        display: none; /* Hides the scrollbar for Webkit browsers */
    }
</style>
