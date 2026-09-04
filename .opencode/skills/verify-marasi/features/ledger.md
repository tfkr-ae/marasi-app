# Traffic ledger

## Sub-features

- HTTP request/response rows and WebSocket streams opened from upgrade requests
- Search, content-type filtering, sorting, and pagination
- Request detail, notes, highlights, and handoff to Launchpad, Armory, or Logbook

## How to get to it (user POV)

Select the rail item titled `Ledger` or press `Command+2`. The page exposes `Ledger Settings`, `#searchBox`, an input with placeholder `Filter by Content Type`, and first/previous/next/last page buttons.

## Driving it with Chrome CDP

Run `scripts/drive.sh ledger` for route proof. For behavior, send a real request through the isolated proxy port, return to Ledger, and locate the request by host or path through `#searchBox`. Capture the request command and response, the resulting DOM and screenshot, and a read-only SQLite query showing the persisted request/response row.

## Gotchas

- An empty Ledger only proves navigation. Complete capture proof needs traffic through the proxy.
- HTTPS traffic needs the verification instance's generated certificate.
- WebSocket flows have separate connection and message views.
- Search and filters can hide newly captured rows; record their values in evidence.
