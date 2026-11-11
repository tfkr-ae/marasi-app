# Ledger: capture proof and the query box

## Driving it with Chrome CDP

Run `scripts/drive.sh ledger` for route proof; it waits for the toolbar's `Saved queries`, which paints whether the dock is open or collapsed. For capture, send a `text/html` request with a unique path through the isolated proxy (`curl -x http://127.0.0.1:<proxy port> …` to a local disposable server), then wait for that path in the table:

```bash
scripts/drive.sh ledger steps '{"name":"capture","steps":[{"waitText":"/ledger-second"}]}'
```

Pair it with a read-only query: `sqlite3 -readonly <project> "select method, host, path, status_code, content_type from request"`.

Search supports field expressions and boolean operators, not just a table substring filter. A proven sequence:

```json
{"name":"search","steps":[
 {"click":"#searchBox"},{"key":"cmd+a"},
 {"insert":"response_body:\"ledger-second\""},{"key":"enter"},
 {"waitSelector":"#ledgerQueryMatchCount"},{"waitText":"1 match"},{"waitText":"1 matching"},
 {"waitNoText":"/ledger-first"},{"waitText":"/ledger-second"},
 {"click":"[aria-label=\"Clear query\"]"},{"waitText":"/ledger-first"}]}
```

The query stays active across navigation until cleared, so the recipe clears it; otherwise later recipes cannot find rows the query excludes.

Enter runs the query at once. Typing alone runs it after a 700 ms debounce. `#ledgerQueryMatchCount` reads `1 match`, `N matches`, or `N+ matches` while older pages remain. The query-help toggle describes the supported fields, operators, and examples.

The query box is a one-line CodeMirror editor; `#searchBox` is its `.cm-content`, so `click`, `cmd+a` and `insert` work as on an input. It offers suggestions in `.cm-tooltip-autocomplete`: fields by prefix while typing a word (including `highlight`, `sitemap`, `finding`, `test_case`, `length` and `metadata.`), a field's operators after `<field> `, and example values after the operator (`*` after `highlight:`, `note:`, `launchpad:`, `finding:`, `test_case:` and `metadata.<key>:`). An empty box opens the ready-made list (`.cm-tooltip-autocomplete.ledger-query-ready`), hung flush from the toolbar's bottom border and spanning the search area; field suggestions hang the same way. Toolbar menu panels (`#ledgerSavedQueriesPanel` and the rest) also hang flush from that border. `Ctrl-Space` opens them on request. Enter picks the selected suggestion while the list is open and runs the query otherwise; a finished value or word offers nothing, so Enter after an inserted query runs it. Pick with `{"click":".cm-tooltip-autocomplete li","hasText":"<label>"}` or `down` and `enter`. Escape leaves the box at once, closing an open list (focus goes back to the page; the query stays; `#ledgerQueryClear` clears it). A click anywhere outside the box leaves it too, rows included. Leaving it (or a drawer editor) clears the DOM selection inside it too: WebKit, unlike Chrome, keeps a blurred editor's selection and goes on drawing its caret, so check with `getSelection().rangeCount` and whether `#searchBox` contains its anchor, in Playwright WebKit as well as Chrome. When the query runs past the box, `#ledgerQueryExpand` (`Show the whole query`, `aria-pressed`) wraps it onto as many lines as it needs, the toolbar growing up to 30vh before the box scrolls; pressing it again (`Back to one line`) returns to one line. An invalid query shows its message in `#ledgerQueryError` (`role="alert"`) in place of the match count and underlines the word at Marasi's position (`.ledger-query-error`). Bare text searches the request, response, note, and metadata, and needs at least three characters; punctuation can require quoting.
