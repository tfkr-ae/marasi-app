# Keybindings and menus

How a keyboard shortcut or a ⌘K menu item reaches its handler, and where a new action must be registered. Names are functions, constants and files in `frontend/src/lib/keybindings/` unless a path says otherwise, so search for them.

## How a key reaches a handler

1. **Catalog.** `FACTORY_ACTIONS` in `catalog.js` holds every built-in action. `buildCatalog` adds the extension actions. Page and drawer ids are `<context>.<slug>` (`pageActions`).
2. **Contexts.** `CONTEXTS` in `contexts.js` says when each context applies (`isEligible`) and how specific it is (tier). They read the state that `shortcutState` in `frontend/src/routes/+layout.svelte` builds. The Armory page has its own drawer, so it reports it through `armoryDrawer` in `app.js`, and the `armory.page` and `armory.drawer` contexts read `state.armoryDrawer`.
3. **Dispatcher.** `installMenuShortcuts` in `app.js` sends each keydown to `menuDispatcher` (`createDispatcher` in `dispatcher.js`). `shortcutGate` in `gate.js` first decides whether shortcuts may run, for example while a modal is open. The most specific eligible context with a live handler for the key wins.
4. **Handlers.** A page registers `{actionId, handler}` with `useMenuActions` for its whole lifetime. Contexts, not registrations, decide which action a key reaches. `GlobalMenu.svelte` holds the handlers and icons for `global.*`. The `global` context is eligible in every state, so a `global.*` action, such as `global.connections`, runs in every menu context unless a more specific context binds the same key.
5. **⌘K.** Where the global menu shows (Home, Settings), ⌘K opens `MarasiMenu.svelte` (in `lib/components/MarasiMenu/`), mounted by `GlobalMenu.svelte` with the catalog's `global` entries. A page still mounts `MarasiKeys.svelte`, the flat list, with its own `menuOptions`. `MarasiMenu` draws `menuModel.js`, a pure module (`node --test`): `buildMenu` builds the sections, menu groups, loose actions and every entry's menu key from the catalog, the entries, the live keymap (`bindingsFor`) and the platform; `entryForKey` picks the entry a ⌘ key opens or runs at a level; `searchMenu` gives a search's matches in draw order. It runs actions through `menuDispatcher.run`.

## Menu groups and menu letters

- A menu group is defined in `FACTORY_MENU_GROUPS` (`menuGroups.js`): context, id, label, factory menu letter, icon (a lucide name) and tone, and a description. A menu action joins one through its `group` field (`inGroup` in `catalog.js`; extension navigation actions join Go to). The catalog exposes them as `groups`, `group(context, id)` and `groupsIn(context)`, and refuses an action whose group isn't in its context. Never rename a group id.
- `RESERVED_MENU_LETTERS` (K, Q, H) sits beside the factory letters in `menuGroups.js`. Change both there.
- `groupStyle.js` maps a group's icon and tone names to the lucide component and Tailwind classes.
- A menu key is primary + the group's menu letter; an action's own first primary binding (Shift and Alt kept); else primary + a letter derived from the label's distinctive words. The menu shortcut and primary + a reserved letter are never menu keys. Menu keys are off while the search has text. A group with one action in the entries is shown as that action.
- A profile can override a group's letter: `letters` in the profile (`[{group, letter}]`, group id `<context>.<group>`, the same on both platforms), next to the binding overrides. `validateLetters` in `profiles.js` refuses a non-letter, K, Q or H, and two groups at one menu level sharing a letter (a context's groups plus the global ones), naming both groups. `liveKeybindings` hands the active profile's letters to the dispatcher, whose snapshot carries them as `letters`, and `MarasiMenu.svelte` passes them to `buildMenu`. `setGroupLetter`, `resetGroupLetter` and `resetGroupLetters` in `settings.js` edit them in the draft.
- `catalog.test.js` checks each group exists in its action's context, letters are unique per level (a context's groups plus the global ones), none is K, Q or H, and every group has a label, icon, tone and description.

## Adding an action

1. Add a row in `FACTORY_ACTIONS`, in its context's `pageActions` block. Never rename an existing id, because saved profiles key their overrides by it. Give every built-in action a default key: the factory profile must have no unbound action (`settings.test.js`). Unmodified Escape, Tab and Enter are reserved (`isReservedBinding`), so a page handles them itself, as the Ledger and Logbook do with Esc. A bare key, such as the Logbook's N, is allowed; it never runs while focus is in a field or editor.
2. A new context also needs an entry in `CONTEXTS`, and a field in `shortcutState` if its eligibility needs new UI state.
3. For a global action, set its menu group with `inGroup` (or leave it loose). Add `{actionId, icon, handler}` to the page's menu array, which it passes to both `useMenuActions` and `MarasiKeys`. For `global.*`, add to the `handlers` and `icons` maps in `GlobalMenu.svelte`.
4. If a row menu or the Ledger drawer rail shows the action, give the item the same `actionId`. See `ledger.md` and `launchpad.md`.
5. If the action opens a modal, pass `toggleAction: "<actionId>"` to `modalStore.trigger`, so the same key closes it (`overlayIsolation.js`).
6. Test the key in `menus.test.js`. It also catches two actions in one context sharing a key.

No test checks a handler's or a menu item's `actionId` against the catalog. A misspelt id fails silently: the menu shows no key, and the shortcut does nothing.

## Profiles and Go

- The settings UI is `frontend/src/lib/components/Keybindings/KeybindingsModal.svelte`, modelled by `settings.js`. It lists every catalog action, so a new one needs no change there.
- `SaveKeybindings` in `keybindings.go` receives the profile with the catalog (`catalogDescriptor` in `profiles.js`: actions, contexts and menu groups with their factory letters). Go owns no list of actions or groups.
- `keybinding_validation.go` repeats the rules of `keys.js`, `gate.js`, `keymap.js` and `profiles.js` by hand (see its header). Change a rule in both. Its letter checks: `menuLetterProblem` and the group-id checks in `checkKeybindingStructure`, and `letterProblems` for clashes; `reservedMenuLetters` repeats `RESERVED_MENU_LETTERS`.
- A saved profile reaches the dispatcher through `readKeybindings` in `frontend/src/stores.js`, then `keybindingState`, then `menuDispatcher.configure` in `GlobalMenu.svelte`.

## Decisions

- [Keybinding profiles override recoverable factory defaults](../../adr/2026-10-10-keybinding-profiles-override-factory-defaults.md)
- [Positional extension defaults yield to other bindings](../../adr/2026-10-10-positional-extension-defaults-yield.md)
- [WebSocket menu action ids keep "frame"](../../adr/2026-10-11-websocket-action-ids-keep-frame.md)
- [A menu action's key in the Marasi menu is its own binding](../../adr/2026-11-08-a-menu-actions-key-in-the-marasi-menu-is-its-own-binding.md)
