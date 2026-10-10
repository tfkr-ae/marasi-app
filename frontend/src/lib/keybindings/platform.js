// Platform variants of a keybinding profile. Marasi keeps the existing
// grouping: macOS versus Windows/Linux. Ids are lowercase so they survive
// Viper's lowercasing if they are ever used as YAML map keys.
export const MACOS = "macos";
export const WINDOWS_LINUX = "windows-linux";
export const PLATFORMS = [MACOS, WINDOWS_LINUX];

// DesktopOS is Go's runtime.GOOS, reported by GetMarasiConfig.
export function platformFromDesktopOS(desktopOS) {
  return desktopOS === "darwin" ? MACOS : WINDOWS_LINUX;
}
