import { get } from "svelte/store";
import { modeUserPrefers, setModeCurrent, setModeUserPrefers } from "@skeletonlabs/skeleton";
import { lightAtStartup } from "./colourScheme.js";

/** Switches light or dark mode, as ⌘U and the Settings switch do. */
export function setLightMode(light) {
  setModeUserPrefers(light);
  setModeCurrent(light);
}

/**
 * Opens the app in the researcher's chosen scheme, else the system's, and
 * follows the system's changes only while they haven't chosen
 * (colourScheme.js). Replaces Skeleton's autoModeWatcher.
 */
export function applyColourScheme() {
  const system = window.matchMedia("(prefers-color-scheme: light)");
  const apply = () => setModeCurrent(lightAtStartup(get(modeUserPrefers), system.matches));
  apply();
  system.onchange = () => {
    if (typeof get(modeUserPrefers) !== "boolean") apply();
  };
}
