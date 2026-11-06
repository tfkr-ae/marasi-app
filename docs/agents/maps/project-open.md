# Startup and opening a project

How the app starts, opens the scratchpad, and switches to another project, across Go, the layout and the stores. Names are functions, stores and files, so search for them. For anything inside one function, read the function.

## Startup order

1. **Go.** `main` registers `App` as the Wails application's service, so Wails calls `App.ServiceStartup` before the window loads. `NewApp` builds the Marasi proxy and calls `newApp`, which tests call directly. `newApp` wires the project lifecycle and the `configure*Handlers` events. `ServiceStartup` opens no project and starts no listener.
2. **Layout.** `StartupRoutine2` in `frontend/src/routes/+layout.svelte` runs `readConfig` (in `frontend/src/stores.js`), then `connectionStore.start()`, and resolves when `loadedProject` is set. Until then the start screen shows the connection's phase, or its error and Retry.
3. **The service.** The connection store starts or attaches to the local instance (`ConnectLocal`), reads `/service/status`, opens `/events`, and runs `loadProject` (`stores/connectionStore.js`): Home's store loads, and `serviceProjectLoaded` names the service's open project and sets `loadedProject` (see `marasi-service.md`, "Moving onto the service").
4. **After the first load.** `StartupRoutine2.then` installs the menu shortcuts and subscribes to the Wails traffic, WebSocket, launch and Checkpoint events the pages not yet on the service still read. No listener starts in process, and the first-run listener setup no longer shows.

Opening and switching below still run in process until the projects ticket moves them to the service.

## Opening and switching

- **Held Checkpoint items.** A switch is refused while Checkpoint holds an item, because Marasi would wait for it with nothing on screen to say so, or drop it when a launch holds it. `openProjectPicker` in `globalActions.js` shows the refusal (`checkpointHeld.js`) in place of the project picker. `OpenProject` also refuses with `checkpoint_held` (`checkpointHeldError`) for an item held after the picker opened, and `openWithScreen` shows the same refusal.
- **Go.** `OpenProject` confirms losing unsaved work, emits `project-opening`, opens through `App.projects` (marasi's `service.ProjectLifecycle`), then runs `prepareOpenedProject`. A project another Marasi owns fails with `project_locked` (`openProjectError`).
- **Opening screen.** `openWithScreen` waits for `project-opening` with `once` (`runtime.js`), then shows the screen after `openingDelay`, so a quick switch never shows it. Its state lives in the `opening` store, its transitions in the `*Opening` functions of `stores.js`, and its pure logic in `frontend/src/lib/openProgress.js`, drawn by `OpeningScreen.svelte`. Progress comes from Marasi's `log` events (`feedOpeningLog` → `withOpenLog`) and from the parts `openProject` reports (`loadSignals`).
- **Pages.** Routes stay mounted under the screen. `openWithScreen` bumps `pagesKey` once `openProject` has loaded, which remounts them for the new project.

## Where a change goes

- Go work every open needs: `prepareOpenedProject`.
- Something the frontend reads per project: a step in `openProject`, reset at its top, plus a `loadSignals` entry and its part in `openProgress.js` so the screen tracks it.
- A subscription that must exist before the first project loads: the top of `onMount` in `+layout.svelte`. Otherwise use `StartupRoutine2.then`, and remove the listener in the same cleanup.
