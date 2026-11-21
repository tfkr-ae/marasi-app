# Excalidraw is a React island, and its cards are the app's own markup

The Drawing page mounts `@excalidraw/excalidraw`, a React component, from Svelte. React and Excalidraw load only when the page opens, at an exact pinned version (React 18: under React 19, Excalidraw 0.18.1 draws two main menus). Running in the page rather than a frame lets Marasi's window key listener see every key, so the Marasi menu works on the canvas, and Excalidraw follows the app's theme.

Cards (pairs, findings and test cases on a drawing) are Excalidraw embeddables whose content is a Svelte component using the app's own classes. We first drew them as images on the canvas, and that failed. Excalidraw's dark mode inverts the whole canvas with a CSS filter and then tries to reverse it per image. WebKit (Safari, the iPad) doesn't reverse it at all, and Chrome only does so approximately, so card colours never matched the app. Embeddables sit over the canvas, outside that filter, so their colours are exact in both modes and they update live with no redrawing.

## Consequences

- A card always draws above every shape and arrow, and Excalidraw's layer ordering doesn't apply to it. To match, an attachment draws its cards last, as light images.
- Each card's underlying shape has a solid fill, hidden under the card, so the whole card area takes arrow bindings and not only its outline. The "will connect" ring is drawn by the card, because Excalidraw's own highlight would be hidden under it.
