# Startup and opening a project

How the app starts, opens the scratchpad, and switches to another project, across the main process, the layout and the stores. Names are functions, stores and files, so search for them. For anything inside one function, read the function.

## Startup order

1. **Main process.** `electron/main.js` creates the window and serves the frontend build. It opens no project: the connected instance has one open.
2. **Layout.** `StartupRoutine2` in `frontend/src/routes/+layout.svelte` runs `readConfig` (in `frontend/src/stores.js`), then `connectWindow`, then `openConnectedProject`, and resolves when `loadedProject` is set.
   - `connectWindow` calls the window connection store's `startup` (`frontend/src/stores/createWindowConnectionStore.js`). The main process (`startup` in `electron/local.js`) connects to the `default` instance, starting it on Marasi's scratchpad when it isn't running. After a reload it keeps the window's connection; after a Disconnect (`global.disconnect`, which reloads the window) it returns none, and the layout shows `ConnectionScreen.svelte` until the researcher connects or starts an instance.
   - Quitting stops only the instances the app started and wasn't disconnected from (`quit` in `electron/local.js`).
   - Each window has one connection. New Window (`global.new-window`, and the Window menu) opens a window that skips the default (`open` in `electron/local.js`) and shows the connection screen, so another instance is connected or started there. `electron/windows.js` keeps each window's project and Checkpoint held count, which the layout reports through `windowList` (`frontend/src/stores/createWindowListStore.js`). `windowsChanged` in `electron/main.js` redraws the Window menu's window list, sets the dock badge to the held total, and tells every renderer, which feeds Switch Window (`global.switch-window`, `MarasiMenu/WindowSwitcher.svelte`).
   - All windows share the default session, so localStorage (light or dark mode) is shared. Each window's requests carry only its own instance's token (`electron/bearer.js`, keyed by webContents id and limited to the instance origin).
3. **Open.** `openConnectedProject` (`frontend/src/lib/globalActions.js`) loads the project the instance already has open, through the project switch store (`projectSwitch` in `frontend/src/stores/projectSwitchStore.js`, logic in `createProjectSwitchStore.js`). Its `load` runs `openProject` in `stores.js`, which reads the project into the stores. The store's `loaded` is set once it has loaded, and startup carries on.
4. **After the first open.** `StartupRoutine2.then` starts the listener (`startListener`), installs the menu shortcuts, and subscribes to v1's `response` and WebSocket events (see `marasi-service.md`).

## Opening and switching

A switch is the instance's: Marasi opens one project at a time, and any client can switch it. The window follows every switch, whoever starts it.

- **Starting one.** `openProjectFile` calls the switch store's `open`, which sends `POST /project/open` with `{name}` (a project in the instance's projects directory) or `{path}` (a path on the instance machine), through `OpenProject` in `frontend/src/lib/bindings/App.js`. The POST answers once the switch is done. The picker is `ProjectModal.svelte`: the instance's `GET /project/list`, newest first (`recentProjects` in `frontend/src/lib/openProgress.js`). On a remote connection it has no Browse, and a path is typed.
- **Following one.** Marasi's `project.opening`, `project.upgrading`, `project.waiting`, `project.opened` and `project.opening_failed` go to the switch store's `on*` methods (`handlers` in `frontend/src/lib/marasiEvents.js`). A switch the window didn't start begins on `project.opening` and loads on `project.opened`. One the window started loads when its POST answers, so `project.opened` doesn't load it twice.
- **Held Checkpoint items.** Marasi waits for them, and for running extension Lua and other work, and says so in `project.waiting`. The screen lists what it waits for, and `Go to Checkpoint` steps it aside for the Checkpoint page, which answers during a switch.
- **Locked projects.** Another instance holds the project: `409 project_already_open`, and `project.opening_failed` reads `project already open: <path>`. Marasi doesn't name the owner, so on a local connection the store asks each local instance's status for that path, and the screen offers `Connect to <owner>`, which opens the owner in a new window (`window:open-instance` in `electron/main.js`, `open(id, instance)` in `electron/local.js`).
- **Opening screen.** A switch shows the screen after `openingDelay`, so a quick one never does; startup and failures show it at once. Its state is the switch store's `opening` and `shown`, its pure logic `frontend/src/lib/openProgress.js` (steps Open, Upgrade, Wait, Load from the events, and the load parts `openProject` reports through `loadPart`), drawn by `OpeningScreen.svelte`. A load that stops at a binding not ported yet still finishes, with empty pages.
- **Launchpad drafts.** Drafts live in the window, keyed by the project's path (`docs/adr/2026-10-31-one-connection-per-window.md`). Before its POST, `open` calls `confirmLeaving`, which `projectSwitchStore.js` wires to `confirmLosingDrafts` in `stores/launchpadStore.js`: no dirty drafts answers at once, otherwise the layout's modal asks once for all of them (Cancel stays put). The load gets `{ own }`; `openProject` passes `keepDrafts: !own` to the launchpad store's `openProject`, so an own switch discards the drafts the researcher agreed to lose, and another client's keeps them for when that project is open again, with a notice (`onNotice`, toasted by the layout).
- **Pages.** Routes stay mounted under the screen. The load bumps `pagesKey` once `openProject` has run, which remounts them for the new project.

## Where a change goes

- Something the frontend reads per project: a step in `openProject`, reset at its top, plus a `loadSignals` entry and its part in `openProgress.js` so the screen tracks it.
- A new `project.*` event or field: the switch store's handler, and a `with…` transition in `openProgress.js`.
- A subscription that must exist before the first project loads: the top of `onMount` in `+layout.svelte`. Otherwise use `StartupRoutine2.then`, and remove the listener in the same cleanup.
- The verify-marasi script `listener-startup.mjs` reads `+layout.svelte` as text. Keep the single `StartProxy(...)` call and the `const StartupRoutine2 = new Promise` line as they are, or update the script.
