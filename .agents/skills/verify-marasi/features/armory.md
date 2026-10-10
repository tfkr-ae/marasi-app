# Request fuzzing

## Sub-features

- Request templates and payload positions
- Wordlists, attack mode, HTTPS, and concurrency settings
- Persisted runs, status polling, and captured traffic
- Request detail handoff from Ledger

## How to get to it (user POV)

Select the rail item titled `Armory` or press `Command+6`. A fresh scratchpad shows `No templates yet` and `No template selected`. `Armory Settings` is only a placeholder panel and works as a route marker. The run controls (attack type, concurrency, HTTPS, wordlists, `Create Draft`, `Launch`) appear in the centre panel once a template is selected.

## Driving it with Chrome CDP

Run `scripts/drive.sh armory` for route proof. For a run, write a one-line wordlist to `$APP_CONFIG_DIR/wordlists/verify-one.txt`, serve a local HTTP endpoint, and drive this proven sequence:

```json
{"name":"one-payload-run","steps":[
 {"waitText":"No templates yet"},
 {"click":"[aria-label=\"Create template\"]"},{"waitSelector":".modal-example-form input"},
 {"click":".modal-example-form input"},{"insert":"verify-armory"},{"text":"Create","within":".modal-example-form"},
 {"waitText":"Template created"},{"waitNoSelector":".modal-example-form"},
 {"click":".cm-content","nth":1},{"key":"cmd+a"},{"insert":"GET /@@x@@ HTTP/1.1\nHost: 127.0.0.1:18099\n\n"},
 {"click":"div[role=switch]:has(input[name=\"Armory HTTPS\"])"},
 {"waitSelector":"div[role=switch][aria-checked=false]:has(input[name=\"Armory HTTPS\"])"},
 {"text":"Add Wordlist"},{"waitSelector":"[aria-label=\"Refresh wordlists\"]"},{"click":"[aria-label=\"Refresh wordlists\"]"},
 {"text":"verify-one.txt"},{"waitSelector":"[aria-label=\"Remove verify-one.txt\"]"},
 {"waitEnabledText":"Launch"},{"text":"Launch"},{"waitText":"Run started"},
 {"waitText":"complete","within":".badge","timeoutMs":15000},
 {"waitText":"/armory-probe","timeoutMs":15000}]}
```

Then query `select status, max_concurrent from armory_run`, and check that `request` rows carry `json_extract(metadata,'$.armory_run_id')`.

## Gotchas

- Wordlists live in `$APP_CONFIG_DIR/wordlists`, not the `.marasi` file. A list seeded after startup appears after `Refresh wordlists` in the Add Wordlist modal; changing routes alone does not reload it.
- A new template's request is empty. Validation then requires at least one `@@x@@` payload position, a `Host` header, and concurrency from 1 to 100.
- Validation is debounced by 300 ms and starts out pending, so `Launch` is disabled until it finishes. Wait with `waitEnabledText`.
- Harpoon and broadside require exactly one wordlist; tandem and maelstrom require one per payload position.
- Run status comes from a 1.5 s poll. Wait for the `.badge` to read `complete`, not for any `complete` text. Traffic rows can arrive after the run completes.
- Template delete and run delete are icon-only buttons with no label; target them through their card.
- Armory traffic goes through the proxy listener, so the listener must be online.
