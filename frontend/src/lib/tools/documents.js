// The app's tool documents (toolDocuments.js): one set per loaded project,
// reported to Go so switching the project or quitting asks first while any
// is non-empty: drawings and recipes. Add a kind here to give a page its own.
import { SetOpenToolDocuments } from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
import { loadedProject } from "../../stores/projectStore.js";
import { createToolDocuments, drawingKind, recipeKind } from "./toolDocuments.js";

export const toolDocuments = createToolDocuments({ drawing: drawingKind, recipe: recipeKind });

export const drawings = toolDocuments.kind("drawing");
export const recipes = toolDocuments.kind("recipe");

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
