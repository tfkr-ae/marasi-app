# Coding standards

These rules need judgement, so no test checks them. Apply each one to the diff. `npm test` (in `frontend/`) already enforces the style rules (square edges, button variants, rem text sizes) and the default shortcuts, so skip them here. The maps in `docs/agents/maps/` describe where code goes; each rule below cites the one it comes from.

## UI copy

- Toasts, status lines, empty states and labels use the fewest words that carry the fact: "Forwarded 6 · 1 gone", not a sentence about what happened. Prototypes too. *The owner rejects heavy-handed copy.*
- UI wording uses the `GLOSSARY.md` terms and keeps the UI names its `_Note_` lines protect: Checkpoint copy says "Intercept"/"Intercepted", not hold or held. *The glossary is the one vocabulary the researcher learns.*
- User-visible error text comes from the code's helper (`codeIDs` in `lib/errorCodes.js`, `chromeErrorText`, `toastError` in `lib/toasts.js`), never from a raw `ServiceError` or Go error string. *Raw text names routes and codes; `toastError` also hides superseded calls.*

## Buttons and type

- An action button takes its variant from `lib/launchpad/format.js`: `primaryVariant($modeCurrent)`, or `tertiaryVariant` for test cases and `neutralVariant` for neutral actions, or the `primaryButton`/`neutralButton` helpers. Hover comes from `app.css`. A diff adds no border, ring or hover class to a button. *Buttons follow the theme in light and dark mode.*
- Text uses the type scale in `docs/agents/maps/ui.md` for its role (title, heading, body, dense, counts). Copy the Marasi menu's larger sizes nowhere else. *Pages share one scale.*

## Keyboard and menus

- A diff changes a default shortcut only when the task asks for it. *Researchers learn the defaults, and profiles build on them.*
- A diff never renames a menu action id (`catalog.js`) unless it adds a migration with the rename. *Saved profiles key their overrides by id (ADR `2026-10-11-websocket-action-ids-keep-frame`).*
- A new built-in action has a ⌘ (Ctrl) default and no bare-key default. *Every shortcut must run with the menu open (ADR `2026-11-08-menu-groups-open-on-option-so-every-shortcut-runs-in-the-menu`).*

## Where code lives

- Service data travels from the frontend service client (`lib/service/`) to a store. It never goes through a Go binding or a Wails event, and Go never imports Marasi's proxy, repositories or `service` package. *The app reaches Marasi only through the control API (ADR `2026-11-06-the-app-reaches-marasi-through-the-control-api`).*
- A feature the control API can't serve is turned off in the app and recorded as a Marasi gap. It is not rebuilt on the client. *Same ADR.*
- A Go binding is only for desktop-shell work: dialogs, clipboard, window, updates, app config, keychain, the CLI, or Chrome. *`marasi-service.md`, "Bindings".*
- A page store is `createXStore(api)` over `createXApi(client)` (`stores/xApi.js`). The adapter maps snake_case to the shape the store reads. The store subscribes to its events with `service.on` in `xStore.js` and registers with `projectData`. *`marasi-service.md`, "Adding a store to the service client".*
- Logic sits in pure modules that take their API as an argument, and components only draw and dispatch. Look for this especially in menus described as data (`rowMenu.js`, `entryMenu.js`). *`node --test` can then run it without Svelte or Wails.*
- An event updates the store in place and keeps what only the app holds: drafts, selection, scroll, the open drawer. *Another client's change shows without a resync (`marasi-service.md`, "Events").*
- Async work that writes after an await binds first (`api.bind()`, `boundAction`, or `settle`/`current` in the connection store) and treats `superseded` as a no-op. *A late answer must not write into another connection's state.*
- The frontend calls the Wails runtime only through `lib/runtime.js`, and Go reaches Wails only through the seams in `desktop.go`. *Tests replace both, and a Wails upgrade then touches one file.*
- An app-wide setting with a per-project value follows `content_type_exclusion.go`: app config YAML plus project client settings, and the project value wins. *ADR `2026-10-16-app-defaults-with-project-overrides`.*
- API compatibility checks `SUPPORTED_API` (`lib/service/apiLevel.js`) and never compares Marasi versions. *The API level is the one supported range.*

## Errors

- A Go error that the frontend acts on carries a code: a constant with a doc comment, wrapped with `codedError`, and read with `codeIDs`. A service code the app knows by another name gets a `renames` row in `lib/service/errors.js`. *The frontend can only match error text (`marasi-service.md`, "Errors the frontend acts on").*

## Tests

- Go tests sit in `app_<topic>_test.go` and run against a fresh `newTestApp`, with desktop and CLI effects replaced by their seams (`fakeCLI`, `recordedEvents`). *They never touch the real desktop or a real Marasi.*
- Frontend tests use `node --test` beside the module (`x.test.js`). They drive a store through its public surface over a fake client or fake API (`fakeServiceClient.js`, a route table). A store with `resync` gets a test that resync replaces server data and keeps local state. *They test the mapping and the store together, and the resync contract is easy to break.*
- A new store method is added to the tests' fake API in the same change. *Otherwise the existing suites stop covering the page.*
- A new phase or event in the connection store adds a case in `reduce`, a step in `perform`, and a scenario in `connectionStore.test.js`. *`marasi-service.md`, "Connection store".*

## Docs

- A change that moves a file, a name or a flow that a map in `docs/agents/maps/` describes updates that map in the same diff. *Agents navigate by the maps, so a stale map sends them to the wrong place.*
- A new domain term or a hard-to-reverse decision goes into `GLOSSARY.md` or a new ADR in `docs/adr/`. *See `docs/agents/domain.md`.*
- Go commands in docs and scripts use `GOWORK=off go …`. *Agent worktrees break without it (`AGENTS.md`).*
