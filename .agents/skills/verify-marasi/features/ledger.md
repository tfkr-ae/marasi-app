# Traffic ledger

## Sub-features

- HTTP request/response rows and WebSocket streams opened from upgrade requests
- Indexed query search, content-type exclusions, sorting, and pagination
- Request detail, notes, highlights, and handoff to Launchpad, Armory, or Logbook

## How to get to it (user POV)

Select the rail item titled `Ledger` or press `Command+2`. The page exposes `Ledger Settings`, `#searchBox` (placeholder `Search traffic…`), an input with placeholder `Filter by Content Type`, and pagination buttons titled `First Page`, `Previous Page`, `Next Page`, and `Last Page`.

## Driving it with Chrome CDP

Run `scripts/drive.sh ledger` for route proof. For capture, send a `text/html` request with a unique path through the isolated proxy (`curl -x http://127.0.0.1:18080 …` to a local disposable server), then wait for that path in the table:

```bash
scripts/drive.sh ledger steps '{"name":"capture","steps":[{"waitText":"/ledger-second"}]}'
```

Pair it with a read-only query: `sqlite3 -readonly <project> "select method, host, path, status_code, content_type from request"`.

Search supports field expressions and boolean operators, not just a table substring filter. A proven sequence:

```json
{"name":"search","steps":[
 {"click":"button.accordion-control"},{"waitSelector":"#searchBox"},{"click":"#searchBox"},{"key":"cmd+a"},
 {"insert":"response_body:\"ledger-second\""},{"key":"enter"},
 {"waitSelector":"#ledgerQueryMatchCount"},{"waitText":"1 match"},
 {"waitNoText":"/ledger-first"},{"waitText":"/ledger-second"},
 {"click":"[aria-label=\"Clear query\"]"},{"waitText":"/ledger-first"},
 {"click":"button.accordion-control"},{"waitNoSelector":"#searchBox"}]}
```

The query stays active across navigation until cleared, so the recipe clears it and closes the panel; otherwise later recipes cannot find rows the query excludes.

Enter runs the query at once. Typing alone runs it after a 700 ms debounce. `#ledgerQueryMatchCount` reads `1 match`, `N matches`, or `N+ matches` while older pages remain. The query-help toggle describes the supported fields, operators, and examples. Bare text searches the request, response, note, and metadata, and needs at least three characters; punctuation can require quoting.

For handoff, click a row with `{"click":"tbody tr","hasText":"<path>"}`, wait for `.drawer`, then use the drawer's shortcuts. For example, `cmd+shift+l` sends the row to Launchpad and shows `Request N sent to Launchpad` with a `Jump to Launchpad` action.

## Gotchas

- `#searchBox`, the content-type chips, and pagination live inside `Ledger Settings`, which starts closed and mounts its content only while open. Open it with `{"click":"button.accordion-control"}`: while a query is active the header reads `Ledger Settings Query <query> N matches`, so an exact `{"text":"Ledger Settings"}` match fails. Wait for `#searchBox` after opening it. `⌘⇧S` toggles the panel, so it closes an open one.
- Content-type chips exclude matching types. The defaults already hide images, fonts, media, JavaScript, CSS, PDF, archives, and office types. Use `text/html` for capture proof. They include `application/octet-stream`, which `python3 -m http.server` sends for extensionless paths, so serve a `.html` path.
- An empty Ledger only proves navigation. Complete capture proof needs traffic through the proxy.
- HTTPS traffic needs the verification instance's generated certificate.
- WebSocket flows have separate connection and message views.
- Search and filters can hide newly captured rows; record their values in evidence.
- The live view batches `request`/`response` events and flushes every 200 ms. Query results are newest first with column sorting disabled. Matching traffic that arrives during a query is staged behind a button labelled `1 new match` or `N new matches`, which appears after the next 5 s poll.
- Content-type exclusions match stored values exactly, not MIME families. Inspect the actual saved chips rather than assuming defaults.
