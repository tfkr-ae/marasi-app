# Keybindings and menus

How a keyboard shortcut or a ⌘K menu item reaches its handler, and where a new action must be registered. Names are functions, constants and files in `frontend/src/lib/keybindings/` unless a path says otherwise, so search for them.

## How a key reaches a handler

1. **Catalog.** `FACTORY_ACTIONS` in `catalog.js` holds every built-in action. `buildCatalog` adds the extension actions. Page and drawer ids are `<context>.<slug>` (`pageActions`).
2. **Contexts.** `CONTEXTS` in `contexts.js` says when each context applies (`isEligible`) and how specific it is (tier). They read the state that `shortcutState` in `frontend/src/routes/+layout.svelte` builds. The Armory page has its own drawer, so it reports it through `armoryDrawer` in `app.js`, and the `armory.page` and `armory.drawer` contexts read `state.armoryDrawer`.
3. **Dispatcher.** `installMenuShortcuts` in `app.js` sends each keydown to `menuDispatcher` (`createDispatcher` in `dispatcher.js`). `shortcutGate` in `gate.js` first decides whether shortcuts may run, for example while a modal is open. The most specific eligible context with a live handler for the key wins.
4. **Handlers.** A page registers `{actionId, handler}` with `useMenuActions` for its whole lifetime. Contexts, not registrations, decide which action a key reaches. `GlobalMenu.svelte` holds the handlers and icons for `global.*`.
5. **⌘K.** `MarasiKeys.svelte` lists the `menuOptions` a page passes it, with text from the catalog. The global list comes from the catalog's `global` context.

## Adding an action

1. Add a row in `FACTORY_ACTIONS`, in its context's `pageActions` block. Never rename an existing id, because saved profiles key their overrides by it. Give every built-in action a default key: the factory profile must have no unbound action (`settings.test.js`). Unmodified Escape, Tab and Enter are reserved (`isReservedBinding`), so a page handles them itself, as the Ledger and Logbook do with Esc. A bare key, such as the Logbook's N, is allowed; it never runs while focus is in a field or editor.
2. A new context also needs an entry in `CONTEXTS`, and a field in `shortcutState` if its eligibility needs new UI state.
3. Add `{actionId, icon, handler}` to the page's menu array, which it passes to both `useMenuActions` and `MarasiKeys`. For `global.*`, add to the `handlers` and `icons` maps in `GlobalMenu.svelte`.
4. If a row menu or the Ledger drawer rail shows the action, give the item the same `actionId`. See `ledger.md` and `launchpad.md`.
5. If the action opens a modal, pass `toggleAction: "<actionId>"` to `modalStore.trigger`, so the same key closes it (`overlayIsolation.js`).
6. Test the key in `menus.test.js`. It also catches two actions in one context sharing a key.

No test checks a handler's or a menu item's `actionId` against the catalog. A misspelt id fails silently: the menu shows no key, and the shortcut does nothing.

## Profiles and Go

- The settings UI is `frontend/src/lib/components/Keybindings/KeybindingsModal.svelte`, modelled by `settings.js`. It lists every catalog action, so a new one needs no change there.
- `SaveKeybindings` in `keybindings.go` receives the profile with the catalog (`catalogDescriptor` in `profiles.js`). Go owns no list of actions.
- `keybinding_validation.go` repeats the rules of `keys.js`, `gate.js`, `keymap.js` and `profiles.js` by hand (see its header). Change a rule in both.
- A saved profile reaches the dispatcher through `readKeybindings` in `frontend/src/stores.js`, then `keybindingState`, then `menuDispatcher.configure` in `GlobalMenu.svelte`.

## Decisions

- [Keybinding profiles override recoverable factory defaults](../../adr/2026-10-10-keybinding-profiles-override-factory-defaults.md)
- [Positional extension defaults yield to other bindings](../../adr/2026-10-10-positional-extension-defaults-yield.md)
- [WebSocket menu action ids keep "frame"](../../adr/2026-10-11-websocket-action-ids-keep-frame.md)
