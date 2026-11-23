# Excalidraw

## Sub-features

- The `@excalidraw/excalidraw` component (pinned) mounted in the page as a React island (`ExcalidrawIsland.svelte`), with its fonts from the app (`/excalidraw-assets/`) and its online features off
- Drawings: the project's in-memory documents as tabs, with New, Switch, Rename, Duplicate and Delete
- Cards: pairs, findings and test cases as embeddables drawn by the app (`CardView.svelte` through `cardEmbed.js`), live, sized to their content, taking arrow bindings over their whole area
- The Insert panel (Traffic, Findings, Test cases), Add to Drawing, and Attach… (SVG or PNG, scene embedded, cards light)
- ⌘K on the canvas, and Excalidraw Shortcuts (`⌘/`) for its help dialog

The pin's contract (offline mount and fonts, theme, ⌘K and ⌘/ on the canvas, a card rendering, binding an arrow and resizing with its content, and the SVG export's scene and light cards) is proven by `scripts/check-tools.sh` against the pinned build. This map covers the entry points in the real app.

## How to get to it (user POV)

- **Rail**: the item titled `Excalidraw`. `drive.sh excalidraw` proves the route (`/excalidraw`, text `Drawing 1`).
- **Go to**: `⌘⇧J`, or `⌘K`, `⌥G`, `Excalidraw`. `drive.sh dashboard compare "Excalidraw" "cmd+shift+j"` proves both.
- **Bottom bar More**: phone layouts only; Excalidraw shows on every layout. Check it on an iOS simulator or Android emulator (README, out of scope here).
- **⌘K actions**: context `excalidraw` in `frontend/src/lib/keybindings/catalog.js` (New `⌘⇧N`, Switch `⌘⇧O`, Rename `⌘⇧R`, Duplicate `⌘⇧E`, Delete `⌘⇧D`, Insert… `⌘⇧I`, Attach… `⌘⇧A`, Excalidraw Shortcuts `⌘/`).
- **Add to Drawing**: `⌘⇧;` (`global.add-to-drawing`) with a Ledger pair open, the Ledger drawer rail's `Add to Drawing` button, or the row menu's and Launchpad entry menu's `Add to Drawing` submenu (`New drawing`, then every drawing, the open one marked `open`). The shortcut and rail add the pair to the last-opened drawing, the submenu to the one picked; each toasts `Added #N to <drawing>` with `Open`, which opens that drawing.

The page is the tab strip, `Insert` (`[data-testid=excalidraw-insert]`, `aria-pressed`), `Attach…` (`[data-testid=excalidraw-attach]`), and the canvas `.excalidraw canvas.interactive`. Cards are `[data-testid=card]` with `data-kind` (`pair`, `finding`, `testCase`), `data-suggested` while an arrow would bind, and `data-deleted` once the source is gone.

## Driving it with Chrome CDP

Proven sequences, from `/excalidraw`:

```json
{"name":"canvas-menu","steps":[{"click":".excalidraw canvas.interactive"},{"key":"cmd+k"},{"waitSelector":"dialog[open]"},
 {"click":"dialog[open] button","hasText":"New Drawing"},{"waitText":"Drawing 2"}]}
```

```json
{"name":"help-key","steps":[{"click":".excalidraw canvas.interactive"},{"key":"cmd+/"},{"waitSelector":".excalidraw .HelpDialog"},
 {"key":"escape"},{"waitNoSelector":".excalidraw .HelpDialog"}]}
```

Add to Drawing, from `/ledger` with one proxied pair (capture one as in ledger.md; `<port>` tells it apart from other rows):

```json
{"name":"add-to-drawing","steps":[{"waitText":"/probe.txt"},{"click":".ledger-row","hasText":"<port>"},{"waitSelector":".ledger-drawer"},
 {"key":"cmd+shift+;"},{"waitText":"to Drawing 1"},{"text":"Open"},{"waitPath":"/excalidraw"},
 {"waitSelector":"[data-testid=card][data-kind=pair]"},{"waitText":"/probe.txt","within":"[data-testid=card]"}]}
```

The drawer rail: `{"click":".ledger-drawer-rail button[aria-label=\"Add to Drawing\"]"},{"waitText":"to Drawing 1"}`. The row menu: `{"click":".ledger-row","hasText":"/probe.txt","button":"right"},{"hover":".ledger-row-menu button","hasText":"Add to Drawing"},{"waitText":"New drawing","within":".ledger-row-submenu"},{"click":".ledger-row-submenu button","hasText":"New drawing"},{"waitText":"to Drawing 2"}` (or `"hasText":"Drawing 1"` for an existing one; item ids carry the document id, which a kind shares with the others, so pick by text). The Insert panel:

```json
{"name":"insert-panel","steps":[{"click":"[data-testid=excalidraw-insert]"},{"waitSelector":"[data-testid=insert-panel]"},
 {"click":"[data-testid=insert-row]","hasText":"/probe.txt"},{"waitSelector":"[data-testid=card][data-kind=pair]"}]}
```

A wait can't count cards: check the screenshot, where the new card sits under the last one added.

## Gotchas

- Drawings live in memory per project; a relaunch starts at `Drawing 1`. Add to Drawing goes to the last-opened drawing, so the toast names it.
- The canvas keeps ⌘D, ⌘=, ⌘-, ⌘0, ⌘G and ⌘⇧G while it has focus (gate.js); every other key, ⌘K included, reaches Marasi.
- Excalidraw reads its asset path when its module first loads. Anything that imports `@excalidraw/excalidraw` before the island sets `EXCALIDRAW_ASSET_PATH` sends the fonts to esm.sh; check-tools.sh fails on that. In this map, look for `esm.sh` in a drive's `-network.json`.
- The fonts' OFL text is served at `/excalidraw-assets/fonts/LICENSE.txt`, and Settings → About's Licences list credits Excalidraw (MIT, the fonts' OFL); check-tools.sh proves both ship.
- Attach… needs a finding or test case (logbook.md). Check the Artifact's file: an SVG with the scene embedded (`payload-type:application/vnd.excalidraw+json`) and each card as a light image drawn last, even with the app in dark mode.
