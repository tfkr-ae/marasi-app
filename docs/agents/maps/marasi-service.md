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

## Desktop seams

`App` reaches the desktop runtime only through replaceable functions, which `useDesktopRuntime` in `desktop.go` points at Wails. Nothing else imports the runtime's functions, so tests replace these, and a Wails upgrade changes only that file.

- `emitEvent` sends an event, and `onEvent` listens for one from the frontend and hands over its payload.
- `messageDialog` shows a message dialog and returns the pressed button's label. `nativeMessageDialog` (`dialog.go`) adapts confirmations for Windows and Linux.
- `openFileDialog` and `saveFileDialog` return the chosen path, or `""` when the user cancelled. Callers treat `""` as a cancel and do nothing.
- `setClipboardText` puts text on the clipboard.
- `quitApp` quits through the normal shutdown: `beforeClose`, then `close`. `beforeClose` asks about unsaved work once per quit: after a confirmed quit or "Restart now", it lets Marasi close without asking again. `close` calls `relaunchIfRestarting` last.

## Errors the frontend acts on

The frontend can only match error text, so an error it must act on carries a code: `<what>: <code>: <cause>`, or `<what>: <code> (<id>, <id>): <cause>` when it names items. Go builds them with `codedError`, `launchpadError` and `openProjectError`. `codeIDs` in `frontend/src/lib/errorCodes.js` reads them back, and helpers such as `launchPending.js` build on it. To handle a new Marasi refusal, add a code constant with a doc comment, wrap the error with `codedError`, then add a frontend helper that calls `codeIDs`.

## Events

- **Go to frontend.** Every event goes through `a.emitEvent`, which tests replace (`recordedEvents`), including Marasi's request, response and log events (`configureTrafficHandlers`) and the `log` events of the logger `startup` attaches (`LogHandler`). Register Marasi handlers in a `configure*Handlers` function called from `newApp`, not in `startup`: each Marasi `With*Handler` option fails when its handler is already set.
- **Frontend subscriptions** are in `onMount` in `frontend/src/routes/+layout.svelte`, which forwards each event to a store's `on*` method. Add the matching `EventsOff` to its cleanup. `EventsOff` removes every listener for that name.
- **Two shapes on `log`.** Marasi's stored logs (`domain.Log`) have capitalised fields. The app's own records (`LogHandler`, and the project lifecycle's log through `newRelayLogger`) have lowercase ones. The Home log table (`LogTable.svelte`) reads `Level`, and `withOpenLog` reads `level`.
- **Frontend to Go.** Extension UIs send `extension_call_function` and `extension_sync_state`. `LoadExtensions` listens for them through `a.onEvent`, and `decodeExtensionFunctionCall` and `decodeExtensionSync` read their payloads.

## Settings

- **App settings** are in `marasi_appconfig.yaml` in the config directory (`Config`, `LoadConfig` in `config.go`). Exported `Config` fields reach the frontend through `GetMarasiConfig`. Flags in `configDefaults` change through `ToggleFlag` and `SetFlag`. Other sections each have a key constant, a `parse*` function called from `LoadConfig`, and getters and setters that write through `writeConfigKeys` in `config_file.go`.
- **Per-project settings** are client settings in the project file, under the client `appClient` (`client_settings.go`). Stores call the generic bindings with their own key prefixes. A key that both Go and JS use is written out in both.
- **App default with a project override.** `content_type_exclusion.go` is the pattern, from [Ledger settings are app defaults with project overrides, stored by the app](../../adr/2026-10-16-app-defaults-with-project-overrides.md).
- `marasi_config.yaml` is Marasi's own config, which service instances share. The app does not keep its settings there.
- **Upstream proxies** (`upstream_proxy.go`). The list is in `marasi_config.yaml` and the selection is a project setting under Marasi's reserved client, so both go through `service.UpstreamProxies`, the same methods the control API handlers call. Its edits take the config lock that every instance shares. It sends the app no events, so Settings reads the list again each time the section opens. Opening a project applies that project's selection, through `ProjectLifecycle`. A selection this machine doesn't list fails the project's traffic closed, and `UpstreamProxyState.configured` reports it.
