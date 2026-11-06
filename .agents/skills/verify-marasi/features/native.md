# Native flows: what the server build cannot show

The `-tags server` build has no window, application menu, native dialog or system clipboard. Wails v3.1.0 answers each call in its own way, and Marasi's seams in `desktop.go` turn those answers into what the page shows. A flow below is proven in the browser only as far as its **Server build** column says; the rest needs its stub, its Go tests, or a check by hand on a native build (`wails3 build`, or `wails3 package` on macOS; run it with `HOME=$(mktemp -d)` to keep the real config untouched).

What the server build does, from the v3.1.0 source (`pkg/application/application_server.go`, `browser_window.go`, `messageprocessor_browser.go`):

- **Message dialogs** never show and never call back. `showMessageDialog` answers at once with the dialog's cancel button (else its default), so every question is declined.
- **Open and save dialogs** fail with `file dialogs not available in server mode`; the binding rejects with that message.
- **Clipboard** `SetText` reports failure, which `CopyCertToClipboard` returns as `copying to the clipboard failed`. In-page copies (`Copy request`, `Copy URL`, `Copy vector`, …) use Chrome's own clipboard and work in the browser.
- **`Window.SetTitle`** succeeds and does nothing; `document.title` stays empty, also after opening a project.
- **`Browser.OpenURL`** opens the URL in the host machine's default browser, outside headless Chrome. Do not trigger it while verifying.
- **Quit** stops the HTTP server. `TERM` (what `cleanup.sh` sends) shuts down without asking about unsaved work.

| Flow | Native call | Server build | How to check it |
| --- | --- | --- | --- |
| Switching projects with dirty Launchpad drafts or active Armory runs (`confirmLosingWork("Switch Project")`) | Warning dialog | Declined at once with no prompt: the picker closes, the project and the draft stay. Proven: `other06b.marasi` was never created. | Go: `app_draft_guard_test.go`. Native: the dialog's text and buttons, and that `Switch Project` switches. |
| Quitting (⌘Q, the macOS app menu's Quit) and the window's close button, with unsaved work | `ShouldQuit` and `WindowClosing`, then a warning dialog | No menu or window exists. | Go: `TestQuittingWithUnsavedWorkAsksBeforeQuitting`, `TestClosingTheWindow*`. Native: ⌘Q and the close button ask, Cancel keeps Marasi open, the action quits once. |
| Restart to update (`RestartToUpdate`, `confirmLosingWork("Restart Marasi")`) | Warning dialog, quit, relaunch | A development build never offers an update; a release build would only stop the server. | Go: the `app_update_*` tests. Native: a release or nightly build installs and relaunches. |
| Open Project › `Browse Files...` (`OpenFileDialog`) | Open dialog | The modal stays open; the console logs `Error opening file dialog: … file dialogs not available in server mode`. No toast. | Type the project's absolute path in `Search or enter new project name...` and press Enter: it opens by path on the service, as the picker's path would. Native: the dialog opens `.marasi` files and Cancel does nothing. |
| Download Certificate (`DownloadCert`, ⌘D) | Save dialog | Toast `Failed to save certificate: file dialogs not available in server mode`. | Fetch the certificate through the proxy: `curl -x 127.0.0.1:<proxy port> http://marasi/cert`. Native: the save dialog and the written `.crt`. |
| Copy Certificate (`CopyCertToClipboard`, ⌘⇧,) | Clipboard | Toast `Failed to copy certificate: copying to the clipboard failed`. | Native: paste the PEM after the success toast. |
| Logbook `Export report` (`ExportReport`) | Save dialog | Rejects with the dialog error; the page shows its `Failed to export the report` error toast (from source, not driven). | Go: `app_reporting_test.go`. Native: the saved report. |
| Logbook artifact download (`DownloadArtifact`) | Save dialog | Rejects; `Failed to save the artifact` error toast (from source, not driven). | Native: the saved file. |
| Keybinding profile `Import` and `Export` (Settings › Keyboard & Editor › Manage) | Open and save dialogs | Stubbed: launch with `MARASI_KEYBINDINGS_PROFILE_FILE=<absolute path>` and both read or write that file without a dialog. Proven with Export. | See `settings.md`. Native: the dialogs themselves. |
| Upstream proxy `Add CA` › `Read from File` (`ReadUpstreamProxyCAFile`) | Open dialog | Stubbed: launch with `MARASI_UPSTREAM_PROXY_CA_FILE=<absolute path>`. | See `settings.md`. Native: the dialog itself. |
| Window title after opening a project | `Window.SetTitle` | No-op. | Native: the title reads the project's name. |
| The update panel's `Compare` and release-page links (`Browser.OpenURL`) | System browser | Opens the host's browser; shown only with a known update. | Native: the link opens the default browser. |
| macOS menu bar (App and Edit menus only) and its shortcuts | Application menu | No menu. | Native: only App and Edit show, and ⌘R, ⌘W and ⌘=/⌘- reach Marasi's own bindings. |
| Start Chrome (`StartBrowser`) | None: it starts a real Chrome process | Works as on desktop and leaves a process running. | Record and stop it yourself. |

`Failed to …` toasts show the Go error's bare message. A `RuntimeError: ` prefix there is a bug.
