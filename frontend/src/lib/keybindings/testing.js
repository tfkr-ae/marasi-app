// Test helpers shared by the keybinding tests. Not imported by the app.
import { validateProfile } from "./profiles.js";

// Every problem in every profile and both platform variants.
export function validateKeybindings(catalog, config) {
  return (config?.profiles ?? []).flatMap((profile) => validateProfile(catalog, profile));
}
