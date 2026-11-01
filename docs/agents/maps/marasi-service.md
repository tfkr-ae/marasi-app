# The marasi service

How the app reaches the Marasi library, how Go and the frontend talk (bindings, events, errors), and where app and project settings live. Names are functions, types and files, so search for them.

## Marasi source

The app pins `github.com/tfkr-ae/marasi` in `go.mod`. `GOWORK=off go list -m -f '{{.Dir}}' github.com/tfkr-ae/marasi` gives that version's source. `~/Projects/marasi-project/marasi` is the sibling checkout, for unreleased changes.

## What the app holds

`App.Proxy` is the `*marasi.Proxy`. Its repositories are nil until a project opens, so call the checked getters (`GetTrafficRepo`, `GetConfigRepo` and the rest), which return an error instead. `App.projects` is marasi's `service.ProjectLifecycle` (open, shut down, background jobs), `App.listener` is the proxy listener, `App.chrome` launches Chrome, and `App.upstreamProxies` is marasi's `service.UpstreamProxies`. `newApp` sets all five. `NewApp` builds the proxy, and tests pass their own.

## Bindings

`main` binds `App`, so every exported `App` method in package `main` is callable from the frontend, whatever file it is in. Wails generates `frontend/src/lib/wailsjs/` from them. That directory is gitignored, so regenerate it with `GOWORK=off wails generate module` (or `scripts/bootstrap.sh`) after you add a method or change its signature.

A binding returns Go structs as JSON. A struct without json tags reaches JS with PascalCase field names. A Go error rejects the promise with its `Error()` text only.

To add a call: write the `App` method in its topic's file and test it with a project open (`newProjectApp`). Then regenerate the bindings, call the method from the topic's `stores/xStore.js`, and keep the logic in `stores/createXStore.js`, which takes its API as an argument so `node --test` can run it.

## Errors the frontend acts on

The frontend can only match error text, so an error it must act on carries a code: `<what>: <code>: <cause>`, or `<what>: <code> (<id>, <id>): <cause>` when it names items. Go builds them with `codedError`, `launchpadError` and `openProjectError`. `codeIDs` in `frontend/src/lib/errorCodes.js` reads them back, and helpers such as `launchPending.js` build on it. To handle a new Marasi refusal, add a code constant with a doc comment, wrap the error with `codedError`, then add a frontend helper that calls `codeIDs`.

## Events

- **Go to frontend.** Send with `a.emitEvent`, which tests replace (`recordedEvents`). The handlers `startup` sets call `runtime.EventsEmit` directly, so tests do not see them. Register Marasi handlers in a `configure*Handlers` function called from `newApp`, not in `startup`: each Marasi `With*Handler` option fails when its handler is already set.
- **Frontend subscriptions** are in `onMount` in `frontend/src/routes/+layout.svelte`, which forwards each event to a store's `on*` method. Add the matching `EventsOff` to its cleanup. `EventsOff` removes every listener for that name.
- **Two shapes on `log`.** Marasi's stored logs (`domain.Log`) have capitalised fields. The app's own records (`LogHandler`, and the project lifecycle's log through `newRelayLogger`) have lowercase ones. The Home log table (`LogTable.svelte`) reads `Level`, and `withOpenLog` reads `level`.
- **Extensions in v2.** `stores/createExtensionsStore.js` follows `extension.enabled`, `extension.updated`, `extension.settings.updated`, `extension.gui.rendered`, `extension.gui.updated` and `extension.log` (wired in `lib/marasiEvents.js`). It is `extensions` and `extensions_ui` in `stores.js`. A `toast` render goes to the layout's toasts, and log lines go to `ExtensionLogs.svelte`'s followers. Buttons and v1's `extension_sync_state` call `POST /extension/{id}/call` (`callExtensionFunction` in `lib/extensions/components/utils.js`), passing the extension's UI as the one argument, as v1 did. Marasi doesn't replay renders, so a reloaded page shows an extension's UI only after it draws again. Settings → Extensions (`ExtensionsSettings.svelte`) turns extensions on or off and edits their settings.
- **Scope in v2.** `stores/createScopeStore.js` reads `GET /scope` on project open and again on `extension.updated` for compass, as Marasi has no scope event. Compass's rule list (`ScopeRules.svelte`) and the dashboard's scope cards read it.

## Settings

- **App settings** are in `marasi_appconfig.yaml` in the config directory, which v1 and v2 share. In v2 the main process owns it: `electron/appConfig.js` (flags, highlights, app saved queries, the default exclusion, test cases) and `electron/keybindings.js` read the file on every call and write one key at a time through `electron/configFile.js`, which keeps unknown keys. The renderer reaches them through `marasiApp.appConfig` (`electron/appConfigIPC.js`, the preload) and the bindings in `frontend/src/lib/bindings/appConfig.js`, which check keybindings against the catalog and normalise the exclusion before they send. v1's version was `Config`/`LoadConfig` in `config.go` and `writeConfigKeys` in `config_file.go` on `main`.
- **Per-project settings** are client settings in the project file, under the client `appClient` (`client_settings.go`). Stores call the generic bindings with their own key prefixes. A key that both Go and JS use is written out in both.
- **App default with a project override.** `content_type_exclusion.go` is the pattern, from [Ledger settings are app defaults with project overrides, stored by the app](../../adr/2026-10-16-app-defaults-with-project-overrides.md).
- `marasi_config.yaml` is Marasi's own config, which service instances share. The app does not keep its settings there.
- **Upstream proxies.** The list is in `marasi_config.yaml` and the selection is a project setting under Marasi's reserved client. In v2 the bindings in `frontend/src/lib/bindings/App.js` call `/upstream-proxy*`; Marasi answers add, update and remove with the list alone, so those bindings read `GET /upstream-proxy` after the change to answer v1's whole state with the selection. `ReadUpstreamProxyCAFile` reads a PEM on this machine (`electron/caFile.js`, or `MARASI_UPSTREAM_PROXY_CA_FILE` in place of the dialog; a file input in the browser bridge). `createUpstreamProxyStore.js` follows `upstream_proxy.*`, so a change from the CLI or another window shows up live, and a selection this machine doesn't list shows as not set up, as Marasi fails its traffic closed. v1's Go side was `upstream_proxy.go` on `main`.
- **Chrome and waypoints.** `createChromeStore.js` holds the instance's Chrome paths and profiles (Settings → Browser, Home's Start Chrome menu) and follows `chrome.*`; `createWaypointStore.js` holds the open project's waypoints and follows `waypoint.*`. On a local connection the Chrome bindings call `/chrome/*`, and Start Chrome opens Chrome on the instance's machine through its proxy listener. On a remote connection Chrome is this machine's (`frontend/src/lib/bindings/chrome.js`, `electron/localChrome.js` behind `localChromeIPC.js`): the app's own paths and profiles in app config keys `v2_chrome_paths` and `v2_chrome_profiles`, user-data-dirs in `<config dir>/v2_chrome_profiles/`, and Marasi's switches. Start Chrome reads `GET /listener/status` and `GET /certificate`'s `spki_hash`, then points Chrome at the remote's proxy address: the one Settings → Browser saved for that remote in `v2_chrome_proxy_addresses` (keyed by the window's own connection origin in the main process), or else the connection's host with the listener's port. The store ignores the instance's `chrome.*` events there.
