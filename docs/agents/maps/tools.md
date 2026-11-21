# Tools

How the CyberChef and Excalidraw pages are built, and where a change to them goes. Files are in `frontend/src/lib/tools/` unless a path says otherwise. The file list per page is in `ui.md`; the menu contexts and canvas keys are in `keybindings-and-menus.md`. Interactsh is still an iframe the layout mounts, and nothing here applies to it.

## Documents: `toolDocuments`

- Drawings and Recipes (`GLOSSARY.md`) live in `toolDocuments.js`: per project, in memory only. A **kind** (`drawingKind`, `recipeKind`) gives a document type its `blank()` fields and `isEmpty`. `documents.js` is the app's one instance, with the `drawings` and `recipes` collections. Pages read and write documents only through a collection, so a later Marasi document store replaces this one module.
- `openCounts` goes to Go as `SetOpenToolDocuments` (`app_tool_documents.go`), so switching the project or quitting asks once while a document is non-empty.
- Both pages draw their tabs with `DocumentTabs.svelte` and ask with `documentPrompts.js`. A new kind goes in `documents.js` and gets these for free.
- `attached` on a document maps a record to the Artifact it made; `attachments.js` attaches, replaces and detaches (`AttachDialog.svelte`, `DeleteDocument.svelte`).

## CyberChef: the adapter

- CyberChef's own UI, built from a pinned tag by `frontend/cyberchef/build.js`, is served at `/tools/cyberchef/` from the app's origin and framed by `cyberchef/ChefFrame.svelte` (ADR `2026-11-21-cyberchef-runs-as-its-own-ui-served-same-origin.md`).
- `cyberchef/chefAdapter.js` is the only code that touches CyberChef's internal `window.app`. Every new CyberChef behaviour goes through a function there, so a version bump breaks in one file.
- `cyberchef/chefTheme.js` maps the app's palette and Text size onto CyberChef. Send to CyberChef is `cyberchef/send.js` and `cyberchef/sendAction.js`.

## Excalidraw: the island and cards

- `ExcalidrawIsland.svelte` mounts the `@excalidraw/excalidraw` React component straight into the Svelte page, with no frame, lazy-loaded on first open (ADR `2026-11-21-excalidraw-is-a-react-island-and-cards-are-the-apps-own-markup.md`). Every feature that reaches the network is off. Its fonts are copied from the npm package into `static/excalidraw-assets` by `frontend/excalidrawAssets.js`.
- A **card** is an Excalidraw embeddable whose link is `marasi://<kind>/<id>` (`cards.js`). The app draws its face with `CardView.svelte` in its own classes, from `cardContent.js`, live from `pairRows.js` and `logbookStore`. Card geometry (`placeCard`, `fitCard`) and the light attachment image (`cardImage.js`, `drawingFile.js`) stay in those modules.

## Licences

The Licences modal (`lib/LicencesModal.svelte`) reads `licences.json`, which `frontend/notices.js` writes at build time. Its Tools group (`toolNotices`) credits CyberChef from its build's `LICENSE` and `MARASI-NOTICE.txt`, and Excalidraw from `frontend/licences/`, which also holds its fonts' OFL text. `excalidrawAssets.js` copies that text beside the fonts. When a pin changes, check those files still match what ships.
