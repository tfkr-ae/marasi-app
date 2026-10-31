# Electron: windows, menus and the updater

## Sub-features

- Startup: the window connects to the `default` instance in its config directory, starting it on the scratchpad when it isn't running
- Start, and the OS dialogs (project, Marasi binary, file saves)
- Windows (one per connection) and native menus, as their tickets port them
- The updater

## How to get to it (user POV)

Open Marasi v2. Verification runs it with `npm run dev`, with `--config-dir` set to the throwaway directory and a DevTools port: `scripts/electron.sh start`.

## Driving it with Chrome CDP

`electron.sh start` prints `cdp=http://127.0.0.1:<port>` and `app_url=http://localhost:<port>/`, and captures `electron-ready.png` once Home shows. Drive the page with `cdp.mjs drive <cdp port> <app_url> <evidence dir> 1600 900 <feature> [steps '<json>' | compare …]`. A `⌘K` menu round trip is proven:

```json
{"name":"electron-menu","steps":[{"key":"cmd+k"},{"waitSelector":"#commandmenu"},{"click":"#commandmenu"},{"insert":"disconnect"},{"waitText":"Disconnect"},{"key":"escape"},{"waitNoSelector":"dialog[open]"}]}
```

Each window is its own DevTools target at `http://127.0.0.1:<cdp port>/json/list`. The driver picks the first page on `app_url`. Native menus, OS dialogs and window frames are outside every page, so prove those by their effect: the page they change, the files they write, or the instance (`resources/bin/marasi --config-dir <config_dir> --json service list`). `electron.sh stop` quits Electron and its dev server.

## Gotchas

- The window is 1600x900 outside, so its page is smaller (about 1600x868 on macOS). `doctor.sh` and `shots` act on the Chrome page only.
- Quitting stops only the instances the app started. An app given the recorded directory connects to the running `default` and leaves it running.
- `ELECTRON_RUN_AS_NODE` is set in some agent shells; `scripts/dev.mjs` clears it for Electron.
