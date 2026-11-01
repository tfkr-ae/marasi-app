# Startup and opening a project

How the app starts, opens the scratchpad, and switches to another project, across Go, the layout and the stores. Names are functions, stores and files, so search for them. For anything inside one function, read the function.

## Startup order

1. **Go.** `main` binds `App` and sets `OnStartup: app.startup`. `NewApp` builds the Marasi proxy and calls `newApp`, which tests call directly. `newApp` wires the project lifecycle and the `configure*Handlers` events. `startup` opens no project and starts no listener.
2. **Layout.** `StartupRoutine2` in `frontend/src/routes/+layout.svelte` runs `readConfig` (in `frontend/src/stores.js`), then `openScratchpad`, and resolves when `loadedProject` is set.
3. **Open.** `openScratchpad` and `openProjectFile` in `frontend/src/lib/globalActions.js` both go through `openWithScreen`. It calls `SetupScratchpad` or `OpenProject` in `app.go`, then `openProject` in `stores.js`, which reads the project into the stores. `finishOpening` sets `loadedProject`.
4. **After the first open.** `StartupRoutine2.then` starts the listener (`startListener`), installs the menu shortcuts, and subscribes to the traffic, WebSocket, launch and log events (see `marasi-service.md`).

## Opening and switching

- **Held Checkpoint items.** A switch is refused while Checkpoint holds an item, because Marasi would wait for it with nothing on screen to say so, or drop it when a launch holds it. `openProjectPicker` in `globalActions.js` shows the refusal (`checkpointHeld.js`) in place of the project picker. `OpenProject` also refuses with `checkpoint_held` (`checkpointHeldError`) for an item held after the picker opened, and `openWithScreen` shows the same refusal.
- **Go.** `OpenProject` confirms losing unsaved work, emits `project-opening`, opens through `App.projects` (marasi's `service.ProjectLifecycle`), then runs `prepareOpenedProject`. A project another Marasi owns fails with `project_locked` (`openProjectError`).
- **Opening screen.** `openWithScreen` waits for `project-opening` with `EventsOnce`, then shows the screen after `openingDelay`, so a quick switch never shows it. Its state lives in the `opening` store, its transitions in the `*Opening` functions of `stores.js`, and its pure logic in `frontend/src/lib/openProgress.js`, drawn by `OpeningScreen.svelte`. Progress comes from Marasi's `log` events (`feedOpeningLog` → `withOpenLog`) and from the parts `openProject` reports (`loadSignals`).
- **Pages.** Routes stay mounted under the screen. `openWithScreen` bumps `pagesKey` once `openProject` has loaded, which remounts them for the new project.

## Where a change goes

- Go work every open needs: `prepareOpenedProject`.
- Something the frontend reads per project: a step in `openProject`, reset at its top, plus a `loadSignals` entry and its part in `openProgress.js` so the screen tracks it.
- A subscription that must exist before the first project loads: the top of `onMount` in `+layout.svelte`. Otherwise use `StartupRoutine2.then`, and remove the listener in the same cleanup.
- The verify-marasi script `listener-startup.mjs` reads `+layout.svelte` as text. Keep the single `StartProxy(...)` call and the `const StartupRoutine2 = new Promise` line as they are, or update the script.
