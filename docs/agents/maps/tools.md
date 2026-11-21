# Tools

How the CyberChef and Excalidraw pages are built, and where a change to them goes. Files are in `frontend/src/lib/tools/` unless a path says otherwise. The file list per page is in `ui.md`; the menu contexts and canvas keys are in `keybindings-and-menus.md`. Interactsh is still an iframe the layout mounts, and nothing here applies to it.

## Documents: `toolDocuments`

- Drawings and Recipes (`GLOSSARY.md`) live in `toolDocuments.js`: per project, in memory only. A **kind** (`drawingKind`, `recipeKind`) gives a document type its `blank()` fields and `isEmpty`. `documents.js` is the app's one instance, with the `drawings` and `recipes` collections. Pages read and write documents only through a collection, so a later Marasi document store replaces this one module.
- `openCounts` goes to Go as `SetOpenToolDocuments` (`app_tool_documents.go`), so switching the project or quitting asks once while a document is non-empty.
- Both pages draw their tabs with `DocumentTabs.svelte` and ask with `documentPrompts.js`. A new kind goes in `documents.js` and gets these for free.
- `attached` on a document maps a record to the Artifact it made; `documentArtifacts.js` attaches, replaces and detaches (`AttachDialog.svelte`, `DeleteDocument.svelte`), bound in `toolItems.js`. A collection's `bind()` turns stale once another project's documents replace it, so a write after an upload is dropped. Findings and test cases (labels, "Untitled …", their Logbook list) are named once, in `recordKinds.js`.

## CyberChef: the adapter

- CyberChef's own UI, built from a pinned tag by `frontend/cyberchef/build.js`, is served at `/tools/cyberchef/` from the app's origin and framed by `cyberchef/ChefFrame.svelte` (ADR `2026-11-21-cyberchef-runs-as-its-own-ui-served-same-origin.md`). It adds 47.8 MiB to each desktop and mobile build (v11.6.0, without `.gz`/`.br`).
- The build puts `frontend/cyberchef/memoryStorage.js` first in CyberChef's `index.html`, so the frame's localStorage is in memory and nothing CyberChef stores (options, theme) reaches the app's origin. `MARASI-NOTICE.txt` names it as our change.
- Whether the app offers CyberChef at all is `chefShown` in `lib/platform.js` (not at phone width); the bar, the rail, ⌘K (`hiddenInMenu`, `CHEF_ACTIONS`), the drawer, `SendToChefButton` and the page read it.
- `cyberchef/chefAdapter.js` is the only code that touches CyberChef's internal `window.app`. Every new CyberChef behaviour goes through a function there, so a version bump breaks in one file.
- `cyberchef/chefTheme.js` maps the app's palette and Text size onto CyberChef. Send to CyberChef is `cyberchef/send.js` and `cyberchef/sendAction.js`.

## Excalidraw: the island and cards

- `ExcalidrawIsland.svelte` mounts the `@excalidraw/excalidraw` React component straight into the Svelte page, with no frame, lazy-loaded on first open (ADR `2026-11-21-excalidraw-is-a-react-island-and-cards-are-the-apps-own-markup.md`). Every feature that reaches the network is off. Its fonts are copied from the npm package into `static/excalidraw-assets` by `frontend/excalidrawAssets.js`.
- A **card** is an Excalidraw embeddable whose link is `marasi://<kind>/<id>` (`cards.js`). The app draws its face with `CardView.svelte` in its own classes, from `cardContent.js`, live from `stores/pairRowsStore.js` and `logbookStore`. `cardEmbed.js` is the `embed` the island takes: a `CardView` per card, fitting each to its content outside the undo history, and the ring while an arrow would bind. Card geometry (`placeCard`, `fitCard`) and the light Artifact image (`cardImage.js`, `drawingFile.js`, `artifactScene`, which keeps each card's `link` and `customData` on its image) stay in those modules.
- The page's own logic (tracking its pair cards, adding a card, Open ↗) is `drawingPage.js`; Add to Drawing is `addToDrawing.js` (`addOpenPairToDrawing` for the global action, which the Ledger drawer runs through the dispatcher). `FALLBACK_VIEWPORT` (`drawingCards.js`) is the canvas size when the real one is unknown.
- Pair rows and the Insert panel's traffic list are service stores: `stores/createPairRowsStore.js` and `stores/createTrafficListStore.js` over `stores/toolTrafficApi.js`, bound in `pairRowsStore.js` and `trafficListStore.js`, which route their events and register with `projectData`.
- Import `@excalidraw/excalidraw` only after the island has set `EXCALIDRAW_ASSET_PATH`: Excalidraw builds its font URLs when its module loads, with esm.sh as the fallback.

## Licences

The Licences modal (`lib/LicencesModal.svelte`) reads `licences.json`, which `frontend/notices.js` writes at build time. Its Tools group (`toolNotices`) credits CyberChef from its build's `LICENSE` and `MARASI-NOTICE.txt`, and Excalidraw from `frontend/licences/`, which also holds its fonts' OFL text. `excalidrawAssets.js` copies that text beside the fonts. When a pin changes, check those files still match what ships.

## Contract checks

`scripts/check-tools.sh` drives the real pinned builds in headless Chrome through `frontend/tool-harness`, a Vite app of its own that mounts the island (with `cardEmbed.js`), `ChefFrame` and the real dispatcher. It is outside `src/routes`, so the app's build never holds it. `frontend/tool-checks/` holds the runners: `check-browser.js` (one named check per contract), `check-licences.js` (no GPL or AGPL package in either tool's tree, and every package declares a licence or has an allow-list reason) and `check-release.js` (no harness in the release build, and the notices above ship). A change to the adapter, the island, the cards or a pin gets a check there, and a bump must pass it.
