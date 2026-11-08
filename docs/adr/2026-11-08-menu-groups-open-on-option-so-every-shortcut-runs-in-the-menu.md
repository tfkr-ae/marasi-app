---
status: accepted, supersedes in part 2026-11-08-a-menu-actions-key-in-the-marasi-menu-is-its-own-binding
---

# Menu groups open on ⌥ so every shortcut runs in the menu

With the Marasi menu open, every shortcut works as it does with the menu closed: the menu closes and the action runs. ⌘K ⌘1 goes Home even though Home sits inside Go to. A menu group opens on ⌥ (Alt on Windows and Linux) + its menu letter. Every key the menu shows for an action is the action's own ⌘ (Ctrl) binding, and it does the same thing with the menu open or closed. The menu never makes up a key for an action.

Marasi's factory defaults always use ⌘ (Ctrl), so every action has a key in the menu out of the box; the Logbook's Next Record moved from a bare N to ⌘⇧], like Next Request and Next Entry. A researcher can still bind a key without a modifier, such as O for the Ledger's Open. It works outside the menu. With the menu open, the search field types it, so the menu shows no key for an action that has only such a binding and names it in the footer as "Outside the menu". The action's other bindings still run from the open menu.

Groups first opened on ⌘ + their letter, and the menu gave a group's key priority over a page action's. Global groups sit on every page, so they took page shortcuts: Project's ⌘P took Toggle Query Fields on the Ledger and the settings toggle on four other pages, and the Ledger action fell back to ⌘T, which is Toggle Vim Mode everywhere else. Once every shortcut runs in the open menu, nine group letters clashed with a real shortcut in their menu.

- **New ⌘ letters for the clashing groups.** They would have to come from the letters no action uses (B, C, E, G, J, M, N, V, W, X, Y, Z), most of them unrelated to the group's name. Any rebinding could take one again.
- **No group keys.** Groups would open only by search or the arrow keys. Nothing clashes, but reaching a group takes more keystrokes.

⌥ was rejected in the prototype because ⌥ + a letter types accented characters on macOS. The menu takes ⌥ + a letter while the search is empty, so nothing is typed. With text in the search, ⌥ types as in any field. No action uses ⌥ + a letter. A profile that binds one to the letter of a group in the same menu is a conflict, shown on both rows of the keybinding editor, and can't be saved. An extension's default on a global group's ⌥ letter is dropped.

What still holds from the earlier decision: an action's key in the menu is its own binding, and the menu shortcut, ⌘Q and ⌘H are never menu keys.
