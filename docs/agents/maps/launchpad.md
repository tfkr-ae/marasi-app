# Launchpad

Which files work together on the Launchpad page, how a launch travels through Go and back as events, and where an entry action goes. Names are functions and files, so search for them.

## Files

- `frontend/src/routes/launchpad/+page.svelte` wires everything together: the dock and tree, the workspace, the entry menu, every action function, and `launchpadMenu` for `useMenuActions` and ⌘K.
- `frontend/src/stores/createLaunchpadStore.js` holds the state, the selectors and the event reducers. It takes its API as an argument. `frontend/src/stores/launchpadStore.js` maps that API to Wails bindings.
- `frontend/src/lib/launchpad/`:
  - `LaunchpadTree.svelte` handles selection and drag-to-move;
  - `LaunchpadWorkspace.svelte` is the draft editor;
  - `entryMenu.js` (`entryMenuFor`) describes the entry menu in the same item shape as the Ledger's `rowMenu.js`, drawn by the same `RowMenu.svelte`. Its Finding and Test case submenus come from `recordItems`, which wraps the Ledger's shared `linkMenu`;
  - the other files are pure helpers.
- Go: the launch and launchpad methods in `app.go`, `launchpad_move.go` (`MoveLaunchpadEntries` and its refusal codes), and `launchpad_search.go`.

## A launch

1. `launch` on the page calls the store's `launch`, which calls the `Launch` binding. Its launch id is also the new entry's pair id.
2. `configureLaunchHandlers` in `app.go` sends `launch-started` and `launch-finished`. `+layout.svelte` passes them to `onLaunchStarted` and `onLaunchFinished`.
3. The new entry arrives as a `request` event (`onRequest` in the store).

While a launch is pending, Marasi refuses to move or remove its pair, or to delete its launchpad. Go reports that as `launch_pending` through `launchpadError`. The store then reads the pending launches again (`PendingLaunches`), and the page explains the refusal with the helpers in `frontend/src/lib/launchPending.js`, which the Ledger shares. `entryMove.js` handles the codes for stale views.

## Adding an entry action

1. Add the item to `entryMenuFor`, with an `actionId` if it has a shortcut. Use `unlessLaunching` to disable it for pending entries.
2. Add a branch to `runEntryAction`, which treats unknown types as a move (see its comment).
3. Add a store method, and map its API name in `launchpadStore.js` and in `fakeApi` in the tests.
4. For a shortcut, add a catalog row in `launchpad.tree` and a `launchpadMenu` entry that calls `runEntryShortcut` (see `keybindings-and-menus.md`).

## Findings and test cases

The entry menu's Finding and Test case submenus sit between Copy browser view URL and Remove. They act on the Entry selection's pairs, as the Ledger's do, and pending launches disable none of them.

- `new-finding` and `new-test-case` open the Logbook modal through `newRecord` with the entries' ids as its requests. Nothing is saved until Save. Their New items carry the `launchpad.tree.create-finding` and `launchpad.tree.create-test-case` shortcuts (⌘⇧F, ⌘⇧B; ⌘⇧T is Toggle TLS), which `runEntryShortcut` runs like the Order ones. `recordItems` takes the ids as `newActionIds`, so a menu without shortcuts leaves them out.
- `link-finding`, `unlink-finding`, `link-test-case` and `unlink-test-case` carry `{ id, title }`. `runRecordAction` on the page calls the store's `linkEntries` or `unlinkEntries(ids, kind, recordId)`, with `kind` "finding" or "test_case", and `changeLinks` shows the Ledger's toasts.
- The store sends an `{ ids }` selection to `linkTraffic` or `unlinkTraffic`, which `launchpadStore.js` maps to `LinkTraffic` and `UnlinkTraffic` through `relinked` (`stores/relinked.js`, shared with the Ledger). `relinked` reloads that kind's list, so the checkmarks are right the next time the menu opens.

## Links to the rest of the app

- **Unsaved drafts.** `reportUnsavedDrafts` tells Go how many unsaved drafts there are (`SetUnsavedDraftCount`), so `confirmLosingWork` asks before a project switch or quitting.
- **The Ledger** reads `launchpads` and `launchesById` from `launchpadStore` for its row menu, and calls `populate` after a change. Its "Jump to Launchpad" opens `/launchpad?id=`, which `openJump` handles.
- **Project switch.** `openProject` in `frontend/src/stores.js` clears the store and fills it again.

## Decisions

- marasi `docs/adr/2026-10-13-launches-are-tracked-and-cancellable.md`
- marasi `docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md`
- marasi `docs/adr/2026-10-18-launchpad-entry-order-is-a-fractional-key-on-the-link.md`
