# CyberChef

## Sub-features

- CyberChef's own UI, built from its pinned tag (`frontend/cyberchef/build.js`) and served by the app at `/tools/cyberchef/`, in a frame the app controls (`ChefFrame.svelte`, `chefAdapter.js`)
- Recipes: the project's in-memory documents as tabs (`toolDocuments`), with New, Switch, Rename, Duplicate and Delete
- Send to CyberChef from any editor but the Ledger query editor, and the Insert panel (traffic only, `Res` for a response)
- Attach… a recipe (input, operations, output) to a finding or test case as an Artifact
- Marasi's keys inside the frame, CyberChef's own Ctrl+Alt keys, and its Save and Load buttons turned into Rename and Switch

The pin's contract (offline load, every adapter call, ⌘K in the frame, Ctrl+Alt+Space bakes, Save and Load intercepted) is proven by `scripts/check-tools.sh` against the pinned build, not by this map; run it after any bump or adapter change. This map covers the entry points in the real app.

## How to get to it (user POV)

- **Rail**: the item titled `CyberChef`. `drive.sh cyberchef` proves the route (`/cyberchef`, text `Recipe 1`, a fresh project's first recipe).
- **Go to**: `⌘⇧Y`, or `⌘K`, `⌥G`, `CyberChef`. `drive.sh dashboard compare "CyberChef" "cmd+shift+y"` proves both land on the same page.
- **Bottom bar More**: phone layouts only, where CyberChef is hidden (it shows from tablet width up, `PHONE_HIDDEN_ACTIONS` in `frontend/src/lib/platform.js`). The server build always reports a desktop OS, so check an iPad simulator for the More entry and an iPhone for its absence (README, out of scope here).
- **⌘K actions**: context `cyberchef` in `frontend/src/lib/keybindings/catalog.js` (Bake `⌘⇧↩`, New `⌘⇧N`, Switch `⌘⇧O`, Rename `⌘⇧R`, Duplicate `⌘⇧E`, Insert Input… `⌘⇧I`, Attach… `⌘⇧A`, Delete `⌘⇧D`).
- **Send to CyberChef**: `⌘E` (`global.send-to-cyberchef`) from a focused editor, or the `Send to CyberChef` button beside the Checkpoint, Launchpad and Logbook editors (`SendToChefButton.svelte`). It goes to `/cyberchef` and fills the open input tab when it is empty, else adds a tab.

The page is the tab strip (`[data-testid=document-tabs]`, tabs `[data-testid=document-tab]`, `+` is `[data-testid=document-new]`), `Duplicate`, `Insert`, `Attach…`, and the frame `iframe[title=CyberChef]`. `Loading CyberChef…` covers it until the adapter is ready; CyberChef's own spinner can stay about a second longer inside the frame.

## Driving it with Chrome CDP

The driver's selectors and `waitText` read the app's document, never the frame's. Prove what lands in CyberChef from a screenshot (`-after.png`), taken by a later drive once its spinner is gone.

Proven sequences:

```json
{"name":"goto-chef-menu","steps":[{"key":"cmd+k"},{"waitSelector":"dialog[open]"},{"key":"alt+g"},
 {"click":"dialog[open] button","hasText":"CyberChef"},{"waitPath":"/cyberchef"},{"waitText":"Recipe 1"},
 {"waitNoText":"Loading CyberChef","timeoutMs":30000}]}
```

⌘K with focus inside the frame (run from `/cyberchef`):

```json
{"name":"chef-menu-new","steps":[{"click":"iframe[title=CyberChef]"},{"key":"cmd+k"},{"waitSelector":"dialog[open]"},
 {"click":"dialog[open] button","hasText":"New Recipe"},{"waitText":"Recipe 2"}]}
```

`{"key":"cmd+shift+n"},{"waitText":"Recipe 3"}` proves the shortcut path. Send to CyberChef, from `/workshop` (the Workshop's Lua editor is an editor like any other):

```json
{"name":"send-to-chef","steps":[{"waitText":"Welcome to the Marasi Workshop"},{"click":"div[data-language=lua]"},
 {"key":"cmd+e"},{"waitPath":"/cyberchef"},{"waitNoText":"Loading CyberChef","timeoutMs":30000}]}
```

then `drive.sh cyberchef steps '{"name":"after-send","steps":[{"waitText":"Recipe 1"}]}'` and check its screenshot: the Workshop's text is the input. Insert, with one proxied pair (see ledger.md for capturing one):

```json
{"name":"chef-insert","steps":[{"waitText":"Recipe 1"},{"key":"cmd+shift+i"},{"waitSelector":"[data-testid=insert-panel]"},
 {"click":"[data-testid=insert-row] button","hasText":"Res"},{"waitSelector":"[data-testid=insert-row]"}]}
```

The screenshot shows the pair's response in the empty input tab. A row click (not `Res`) inserts the request, and a second insert opens a new input tab.

## Gotchas

- Recipes live in memory per project. Switching the project or quitting with a non-empty recipe asks first (project-open.md); a relaunch starts at `Recipe 1` again.
- CyberChef's Save and Load recipe buttons (and Ctrl+Alt+L) open Rename and Switch; its local storage never holds recipes. Its own shortcuts are Ctrl+Alt+letter on every platform: Ctrl+Alt+Space bakes, and Ctrl+Alt+B toggles a breakpoint (v11.6.0).
- `{"key":"ctrl+alt+space"}` reaches the frame when it has focus, but the result is only visible in a screenshot; check-tools.sh proves the bake.
- Attach… needs a finding or test case to attach to (logbook.md); the Artifact is one text file with the input, the operations and the output.
