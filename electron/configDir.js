// Marasi's config directory, which holds the app config v1 and v2 share and
// the instances the app connects to. It is the CLI's default,
// os.UserConfigDir()/Marasi; Electron's appData is the same OS directory.
// `--config-dir DIR` replaces it, as it does for the CLI, so tests and
// verification never touch the researcher's own config.
import { join, resolve } from "node:path";

export function marasiConfigDir({ appData, configDirSwitch = "" }) {
  return configDirSwitch ? resolve(configDirSwitch) : join(appData, "Marasi");
}
