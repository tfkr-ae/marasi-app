// The file Attach… uploads for a Drawing: SVG (the default) or PNG, with
// the editable scene embedded. Its cards are redrawn light at their size on
// screen and drawn after every other element (attachmentScene), so an arrow
// running under a card is hidden as it is on screen, and the canvas is light
// whatever mode the app is in.
import { attachmentScene, isCard } from "./cards.js";
import { cardImage } from "./cardImage.js";

export const DRAWING_FORMATS = [
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
];

const baseName = (name) => String(name).trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "drawing";

/** A File of the drawing on screen. `lib` is Excalidraw's module, `api` its imperative API. */
export async function drawingFile(lib, api, name, format) {
  const elements = api.getSceneElements();
  const images = {};
  for (const element of elements) if (isCard(element)) images[element.id] = await cardImage(element);
  const scene = attachmentScene(elements, api.getFiles(), images);
  const appState = {
    exportEmbedScene: true,
    exportBackground: true,
    exportWithDarkMode: false,
    viewBackgroundColor: api.getAppState().viewBackgroundColor ?? "#ffffff",
  };
  const base = baseName(name);
  if (format === "png") {
    const blob = await lib.exportToBlob({ elements: scene.elements, files: scene.files, appState, mimeType: "image/png" });
    return new File([blob], `${base}.excalidraw.png`, { type: "image/png" });
  }
  const svg = await lib.exportToSvg({ elements: scene.elements, files: scene.files, appState });
  const text = new XMLSerializer().serializeToString(svg);
  return new File([text], `${base}.excalidraw.svg`, { type: "image/svg+xml" });
}
