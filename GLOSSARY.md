# Marasi App

The desktop app for Marasi. It presents a project's traffic and the proxy's tools to a researcher. Terms Marasi itself defines, such as traffic, request/response pair, and query, keep Marasi's meaning here.

## Language

### Ledger

**Ledger**:
The app's table of the open project's traffic.
_Avoid_: history, HTTP history, proxy items

**Live view**:
The ledger with no query: every request/response pair, with new traffic appearing as it is captured.
_Avoid_: unfiltered view, all items

**Query**:
A text expression that narrows the ledger to the request/response pairs that match it, as Marasi defines it. It is not stored.
_Avoid_: search, search string, filter, FTS

**Query results**:
The request/response pairs that match the ledger's current query, newest first.
_Avoid_: search results, filtered items

**New matches**:
Request/response pairs that match the current query but arrived or started matching after the query results were shown. They join the query results only when the researcher asks.
_Avoid_: updates, live results

**Content-type exclusion**:
The project's list of content types the ledger hides, in both the live view and query results. A pair with no content type yet is never hidden by it.
_Avoid_: filter, content type filter
