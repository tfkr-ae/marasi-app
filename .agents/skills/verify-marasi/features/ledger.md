# Traffic ledger

## Sub-features

- HTTP request/response rows and WebSocket streams opened from upgrade requests
- Indexed query search, content-type exclusions, sorting, and pagination
- Request detail, notes, highlights, and handoff to Launchpad, Armory, or Logbook

## How to get to it (user POV)

Select the rail item titled `Ledger` or press `Command+2`. The page exposes `Ledger Settings`, `#searchBox`, an input with placeholder `Filter by Content Type`, and first/previous/next/last page buttons.

## Driving it with Chrome CDP

Run `scripts/drive.sh ledger` for route proof. For behavior, send a real request through the isolated proxy port, return to Ledger, and locate the request by host or path through `#searchBox`. Capture the request command and response, the resulting DOM and screenshot, and a read-only SQLite query showing the persisted request/response row.

Search supports field expressions and boolean operators, not just a table substring filter. For a controlled response containing `verification-response`, enter `response_body:"verification-response"`, press Enter, and wait for the match count before opening the row. The query-help toggle describes supported fields, operators, and examples. Bare text searches request, response, note, and metadata and needs at least three characters; punctuation can require quoting.

## Gotchas

- `#searchBox`, content-type chips, and pagination live inside `Ledger Settings`, which starts closed.
- Content-type chips exclude matching types. Defaults already hide images, fonts, media, JavaScript, CSS, PDF, archives, and office types. Use `text/html` or similar for capture proof.
- An empty Ledger only proves navigation. Complete capture proof needs traffic through the proxy.
- HTTPS traffic needs the verification instance's generated certificate.
- WebSocket flows have separate connection and message views.
- Search and filters can hide newly captured rows; record their values in evidence.
- Queries debounce for 700 ms. Query results are newest-first with column sorting disabled; arriving matching traffic is staged behind a `new matches` button until merged.
- Content-type exclusions match stored values exactly, not MIME families. Inspect the actual saved chips rather than assuming defaults.
