# A menu action's key in the Marasi menu is its own binding

With the Marasi menu open, the researcher keeps ⌘ (Ctrl on Windows and Linux) held: ⌘ + a menu group's menu letter opens the group, and a menu action runs on its own binding from the active keybinding profile. ⌘K ⌘G ⌘, opens Settings because Settings is ⌘, everywhere. A key shown in the menu therefore always works outside it too, and the menu teaches the real shortcuts. Only an action whose binding doesn't use ⌘ (a bare key, or a ⌃ binding on macOS) gets a menu letter derived from its label, and ⌘K, ⌘Q and ⌘H are never menu keys.

The prototype (`prototype/marasi-menu`, commit `54f5c9d2`) tried the alternatives:

- **Derived letters for every action** (variants A and B). Letters taken from labels clash quickly in a long group, so many end up on a word's third or fourth letter and mean nothing. They also contradict the action's real shortcut, which the menu shows beside them.
- **Bare letters** (variants A and B). A bare letter on a row reads as a shortcut that works outside the menu, but it doesn't. It also needs the search box to give up its typing, so the menu has to switch between typing and picking.
- **⌥ jumps** (variants A2 and C). ⌥ + a letter types accented characters on macOS and is a different chord from the ⌘ the researcher just pressed for ⌘K. It also keeps the menu from showing the real ⌘ shortcuts.

Menu keys are off while the search box has text, so ⌘A, ⌘C, ⌘V, ⌘X and ⌘Z edit the search as usual.
