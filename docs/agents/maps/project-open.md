# Startup and opening a project

How the app starts on the service's project and switches to another one, across Go, the layout and the stores. Names are functions, stores and files, so search for them. For anything inside one function, read the function.

## Startup order

1. **Go.** `main` registers `App` as the Wails application's service, so Wails calls `App.ServiceStartup` before the window loads. `NewApp` builds the Marasi proxy and calls `newApp`, which tests call directly. `newApp` wires the project lifecycle and the `configure*Handlers` events. `ServiceStartup` opens no project and starts no listener.
2. **Layout.** `StartupRoutine2` in `frontend/src/routes/+layout.svelte` runs `readConfig` (in `frontend/src/stores.js`), then `connectionStore.start()`, and resolves when `loadedProject` is set. Until then the start screen shows the connection's phase, or its error and Retry.
3. **The service.** The connection store starts or attaches to the local instance (`ConnectLocal`), reads `/service/status`, opens `/events`, and loads whatever project the service has open: the scratchpad (`<config dir>/projects/scratchpad.marasi`) on a fresh instance. Its `loadProject` (`stores/connectionStore.js`) runs `loadProject` in `stores/projectStore.js`, then `projectStore.loaded(path)` names the project and sets `loadedProject` (see `marasi-service.md`, "Moving onto the service"). The app never opens the scratchpad itself.
4. **After the first load.** `StartupRoutine2.then` installs the menu shortcuts and subscribes to the Wails traffic, WebSocket, launch and Checkpoint events the pages not yet on the service still read. No listener starts in process, and the first-run listener setup no longer shows.

## Opening and switching

The flow is `open(target)` in `stores/createProjectStore.js`, over `projectApi.js` (the service client) and bound in `stores/projectStore.js`. `projectStore.test.js` runs it against a fake client. A target is `{name}` (a project in the service's `projects` dir) or `{path}` (an absolute `.marasi` file); `projectTarget` turns what the picker gives into one.

- **Held Checkpoint items.** A switch is refused while Checkpoint holds an item, because the service would wait for it with nothing on screen to say so. `openProjectPicker` in `globalActions.js` shows the refusal (`checkpointHeld.js`) in place of the picker, from `projectStore.held()`. `open` reads `GET /checkpoint` again first, for an item held after the picker opened, and resolves `{status: "held", ids}`, which `globalActions.js` shows as the same modal.
- **Unsaved work.** `open` then asks Go's `ConfirmProjectSwitch` (`confirmLosingWork`: unsaved Launchpad drafts, active Armory runs). A no resolves `{status: "cancelled"}` and shows nothing.
- **The service.** `POST /project/open` is synchronous and returns the canonical path. A refusal leaves the service's project as it was: `409 project_already_open` reads as `project_locked` (`lib/service/errors.js`), and `project_busy` (an Armory run) as any other failure.
- **Opening screen.** `open` keeps the screen's state in the store (`opening`, `shown`), exported as the `opening` and `openingShown` stores. It shows the screen after `openingDelay` once the prompt is past, so a quick switch never shows it, and at once on a failure. Its pure logic is `lib/openProgress.js`, drawn by `OpeningScreen.svelte`. Steps come from the service's `project.*` events (`withProjectEvent`): `project.opening` (Open), `.upgrading` (Upgrade, with the migration and `applied/total`), `.waiting` (Wait, naming what the service waits for), `.opened` (Load), and `.opening_failed` (its reason goes to Details, also after the refusal). Events for another path are ignored; an open by name takes its path from the first event for that name. The load reports its parts through `part(signal)` (`loadSignals`).
- **Failure.** The screen lists the service's projects (`GET /project/list`) to open instead. These are the app's recent projects for now (per connection in a later ticket); a project opened by a path outside the service's `projects` dir isn't listed. `stay()` keeps the loaded project, or the target when it opened but didn't load; `retry()` re-runs the last target.
- **Load and pages.** After the switch, `loadProject` (`projectStore.js`) resets every store (`resetProject` in `stores.js`) and loads the stores registered with `projectData` (`stores/projectData.js`). `open` then bumps `generation` (`pagesKey`), which remounts the pages, and `globalActions.js` goes to `/` and toasts. `reload(path)` runs the same load, opening screen and remount without an open or a prompt, for a reconnect that found another project or a restarted service (the connection store asks first; see `marasi-service.md`, "Reconnect").

## Where a change goes

- Work every open needs: the service does it; the app only loads.
- Something the frontend reads per project: `projectData.register` in its `xStore.js`, with its `clear`, `load`, `resync` and `signal` (`loadSignals.x`, with its part in `openProgress.js`, so the screen tracks it). See `marasi-service.md`, "Adding a store to the service client".
- A subscription that must exist before the first project loads: the top of `onMount` in `+layout.svelte`. Otherwise use `StartupRoutine2.then`, and remove the listener in the same cleanup.
