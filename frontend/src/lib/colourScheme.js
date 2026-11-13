// Which colour scheme the app opens in: the one the researcher chose (⌘U,
// Settings, the Color Scheme tile), else the system's. Skeleton's
// autoModeWatcher always took the system's, so a researcher who chose dark
// on a light system reopened to light pages under dark-styled buttons.

/** Light (true) or dark (false): `chosen` when there is one, else the system's. */
export const lightAtStartup = (chosen, systemLight) => (typeof chosen === "boolean" ? chosen : systemLight);
