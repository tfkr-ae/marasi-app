import { setModeCurrent, setModeUserPrefers } from "@skeletonlabs/skeleton";

/** Switches light or dark mode, as ⌘U and the Settings switch do. */
export function setLightMode(light) {
  setModeUserPrefers(light);
  setModeCurrent(light);
}
