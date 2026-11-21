// The app's tool documents (toolDocuments.js): one set per loaded project,
// reported to Go so switching the project or quitting asks first while any
// is non-empty. Add a kind here, beside drawings, to give a page its own.
import { SetOpenToolDocuments } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
import { loadedProject } from "../../stores/projectStore.js";
import { createToolDocuments, drawingKind } from "./toolDocuments.js";
import { createDrawingCards } from "./drawingCards.js";

export const toolDocuments = createToolDocuments({ drawing: drawingKind });

export const drawings = toolDocuments.kind("drawing");

// The canvas's size when the Excalidraw page last showed it, for placing a
// card on a drawing that isn't on screen (Add to Drawing).
let canvasSize = null;
export const setCanvasSize = (size) => {
  canvasSize = size;
};

export const drawingCards = createDrawingCards(drawings, {
  viewport: () =>
    canvasSize ?? {
      width: typeof window === "undefined" ? 1200 : window.innerWidth,
      height: typeof window === "undefined" ? 800 : window.innerHeight,
    },
});

loadedProject.subscribe((project) => {
  if (project) toolDocuments.useProject(project.path);
});

// Keeps Go told how many non-empty documents of each kind there are.
// Returns the unsubscribe function.
export function reportOpenToolDocuments() {
  const reported = {};
  return toolDocuments.openCounts.subscribe((counts) => {
    for (const [kind, count] of Object.entries(counts)) {
      if (reported[kind] === count) continue;
      reported[kind] = count;
      SetOpenToolDocuments(kind, count).catch((err) => console.error(`reporting open ${kind}s:`, err));
    }
  });
}
