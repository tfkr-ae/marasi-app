// The Logbook store: the project's findings and test cases, what each still
// needs before the report, and how the Logbook lists them. Every backend
// call goes through the injected `api` (logbookApi.js maps the service's),
// so this module loads under node --test.
import { get, writable } from "svelte/store";
import { severityFromScore } from "../lib/severity.js";
import { boundAction } from "../lib/service/boundAction.js";
import { isSuperseded } from "../lib/service/errors.js";

const filled = (text) => !!text?.trim();
const linked = (record) => (record.Requests ?? []).length > 0;

/**
 * The items each kind of record has, in the order a reviewer reads them.
 * A record is Done when every required item is filled.
 */
export const ITEMS = {
  finding: [
    { key: "WriteUp", label: "Writeup", missing: "No writeup", required: true, done: (r) => filled(r.WriteUp) },
    { key: "CVSSVector", label: "CVSS score", missing: "No CVSS", required: true, done: (r) => filled(r.CVSSVector) },
    {
      key: "TreatmentPlan",
      label: "Treatment plan",
      missing: "No treatment plan",
      required: true,
      done: (r) => filled(r.TreatmentPlan),
    },
    { key: "Requests", label: "Linked requests", missing: "No requests", required: true, done: linked },
    { key: "TestCaseID", label: "Test case", required: false, done: (r) => !!r.TestCaseID },
  ],
  testCase: [
    { key: "Note", label: "Note", missing: "No note", required: true, done: (r) => filled(r.Note) },
    { key: "Category", label: "Category", required: false, done: (r) => filled(r.Category) },
    { key: "Requests", label: "Linked requests", required: false, done: linked },
  ],
};

// The item whose absence makes a record Not started.
const STARTED_BY = { finding: "WriteUp", testCase: "Note" };

/**
 * What a record has and lacks: `items` ({ key, label, required, done }),
 * `done` of `total` required items, `status` ("done" or "progress") and
 * `notStarted`, true for an In progress record with no writeup or note.
 */
export function completenessOf(kind, record) {
  const items = ITEMS[kind].map(({ key, label, required, done }) => ({
    key,
    label,
    required,
    done: done(record),
  }));
  const required = items.filter((item) => item.required);
  const done = required.filter((item) => item.done).length;
  return {
    items,
    done,
    total: required.length,
    status: done === required.length ? "done" : "progress",
    notStarted: !items.find((item) => item.key === STARTED_BY[kind]).done,
  };
}

/** Severities from most to least severe. */
export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"];
const rank = (severity) => {
  const at = SEVERITIES.indexOf(severity);
  return at < 0 ? SEVERITIES.length : at;
};

/** The category a test case lists under. */
export const categoryOf = (testCase) => testCase.Category?.trim() || "Uncategorized";
const tagsOf = (testCase) => testCase.Tags ?? [];

function initialFilters() {
  // kind: "all", "findings" or "testCases"; manualKind: the tester picked
  // the kind, so clearing a filter leaves it. status: "all", "progress" or
  // "done". Severities filter findings only, categories and tags test cases.
  return {
    q: "",
    kind: "all",
    manualKind: false,
    severities: [],
    categories: [],
    tags: [],
    status: "all",
  };
}

function initialState() {
  // grouping: findings by "severity" or "none"; test cases by "category",
  // "tag" or "none". open: the record in the workspace as { kind, id,
  // focus }, kind "finding" or "testCase" and focus the key of the item it
  // opened at (or null), or null while the list shows.
  return {
    findings: [],
    testCases: [],
    filters: initialFilters(),
    grouping: { findings: "severity", testCases: "category" },
    open: null,
    // The modal's edit session, or null while it is closed:
    // { kind, isNew, original, draft, confirming, saving, error }.
    session: null,
    // The inline fix on the open record's checklist, or null: an edit
    // session on one item, { kind, id, item, original, draft, focus, auto,
    // seq, leaving, saving, error }. auto: it opened by itself, on arrival
    // or after a save; leaving: a move away is waiting on Keep editing or
    // Discard.
    fix: null,
  };
}

const contains = (q, values) => values.some((value) => (value ?? "").toLowerCase().includes(q));

const findingMatches = (filters, q) => (f) =>
  (!q || contains(q, [f.Title, f.Severity, f.WriteUp, f.TreatmentPlan])) &&
  (!filters.severities.length || filters.severities.includes(f.Severity));

const testCaseMatches = (filters, q) => (t) =>
  (!q || contains(q, [t.Title, t.Description, t.Category, t.Note, ...tagsOf(t)])) &&
  (!filters.categories.length || filters.categories.includes(categoryOf(t))) &&
  (!filters.tags.length || tagsOf(t).some((tag) => filters.tags.includes(tag)));

const byStatus = (kind, status) => (record) =>
  status === "all" || completenessOf(kind, record).status === status;

const findingOrder = (a, b) =>
  rank(a.Severity) - rank(b.Severity) || (Number(b.CVSSScore) || 0) - (Number(a.CVSSScore) || 0);
const testCaseOrder = (a, b) => (a.Title ?? "").localeCompare(b.Title ?? "");

function listed(state, filters) {
  const q = filters.q.trim().toLowerCase();
  const findings =
    filters.kind === "testCases"
      ? []
      : state.findings
          .filter(findingMatches(filters, q))
          .filter(byStatus("finding", filters.status))
          .sort(findingOrder);
  const testCases =
    filters.kind === "findings"
      ? []
      : state.testCases
          .filter(testCaseMatches(filters, q))
          .filter(byStatus("testCase", filters.status))
          .sort(testCaseOrder);
  return { findings, testCases };
}

/** The records the Logbook lists, in order: { findings, testCases }. */
export const filteredOf = (state) => listed(state, state.filters);

/** The same list with any status, for the status toggle's counts. */
export const anyStatusOf = (state) => listed(state, { ...state.filters, status: "all" });

/**
 * Findings per severity, { Critical: n, … }, of those the search and status
 * leave. The severity filter itself is ignored, so each severity still
 * shows what picking it would add.
 */
export function severityCountsOf(state) {
  const { findings } = listed(state, { ...state.filters, kind: "all", severities: [] });
  return Object.fromEntries(
    SEVERITIES.map((severity) => [severity, findings.filter((f) => f.Severity === severity).length]),
  );
}

const sortedSet =(values) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
/**
 * The category and tag menus' options: every category and tag in the
 * Logbook, as { value, count }, counting the test cases the search, status
 * and the other menu leave.
 */
export function testCaseCountsOf(state) {
  const counted = (patch, valuesOf) => {
    const { testCases } = listed(state, { ...state.filters, kind: "all", ...patch });
    return sortedSet(state.testCases.flatMap(valuesOf)).map((value) => ({
      value,
      count: testCases.filter((t) => valuesOf(t).includes(value)).length,
    }));
  };
  return {
    categories: counted({ categories: [] }, (t) => [categoryOf(t)]),
    tags: counted({ tags: [] }, tagsOf),
  };
}

const nonEmpty =(groups) => groups.filter((group) => group.items.length);

// Groups `items`, already in list order, `by` "severity", "category", "tag"
// or "none".
function grouping(items, by) {
  if (by === "severity")
    return nonEmpty(
      SEVERITIES.map((severity) => ({
        key: severity,
        title: severity,
        items: items.filter((f) => f.Severity === severity),
      })),
    );
  if (by === "category")
    return sortedSet(items.map(categoryOf)).map((category) => ({
      key: category,
      title: category,
      items: items.filter((t) => categoryOf(t) === category),
    }));
  if (by === "tag")
    return nonEmpty([
      ...sortedSet(items.flatMap(tagsOf)).map((tag) => ({
        key: `#${tag}`,
        title: tag,
        items: items.filter((t) => tagsOf(t).includes(tag)),
      })),
      { key: "#none", title: "No tags", items: items.filter((t) => !tagsOf(t).length) },
    ]);
  return nonEmpty([{ key: "all", title: null, items }]);
}

/**
 * The listed records in their groups: { findings, testCases }, each a list
 * of { key, title, items }. Without grouping there is one group, titled
 * null. Grouped by tag, a test case sits under each of its tags.
 */
export function groupsOf(state) {
  const { findings, testCases } = filteredOf(state);
  return {
    findings: grouping(findings, state.grouping.findings),
    testCases: grouping(testCases, state.grouping.testCases),
  };
}

const recordsOf = (state, kind) => (kind === "finding" ? state.findings : state.testCases);
const listOf = (kind) => (kind === "finding" ? "findings" : "testCases");

/**
 * The open record as { kind, record, focus }, focus the key of the item it
 * opened at or null, or null when the list shows.
 */
export function openRecordOf(state) {
  if (!state.open) return null;
  const record = recordsOf(state, state.open.kind).find((r) => r.ID === state.open.id);
  return record ? { kind: state.open.kind, record, focus: state.open.focus ?? null } : null;
}

const sameID = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * The records linked to `record`, as [{ kind, record }], whatever the
 * filters: a finding's test case, or a test case's findings, most severe
 * first.
 */
export function linkedOf(state, kind, record) {
  if (kind === "finding")
    return state.testCases
      .filter((t) => sameID(t.ID, record.TestCaseID))
      .map((t) => ({ kind: "testCase", record: t }));
  return state.findings
    .filter((f) => sameID(f.TestCaseID, record.ID))
    .sort(findingOrder)
    .map((f) => ({ kind: "finding", record: f }));
}

/**
 * The record Next opens, as { kind, record }: the one after the open record
 * in the order the tester sees, the findings then the test cases in their
 * groups, wrapping to the top. A test case under several tags counts at its
 * first. With no status filter it skips Done records. Null with nothing
 * open or nothing else to go to.
 */
export function nextOf(state) {
  if (!state.open) return null;
  const groups = groupsOf(state);
  const seen = new Set();
  const list = [
    ...groups.findings.flatMap((g) => g.items.map((record) => ({ kind: "finding", record }))),
    ...groups.testCases.flatMap((g) => g.items.map((record) => ({ kind: "testCase", record }))),
  ].filter(({ kind, record }) => {
    const key = `${kind}:${record.ID}`;
    return !seen.has(key) && seen.add(key);
  });
  const isOpen = ({ kind, record }) => kind === state.open.kind && record.ID === state.open.id;
  const at = list.findIndex(isOpen);
  const after = [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))];
  const skipDone = state.filters.status === "all";
  return (
    after.find(
      (entry) =>
        !isOpen(entry) && (!skipDone || completenessOf(entry.kind, entry.record).status !== "done"),
    ) ?? null
  );
}

/**
 * What an export of the whole Logbook holds, in report order: findings by
 * severity then score, test cases as the service lists them (none when
 * `includeTestCases` is false). Also the findings per severity, the linked
 * requests and artifacts as `evidence`, and the `gaps`, each missing
 * required item as { kind, record, key, label }, item by item, with
 * `gapGroups` as [{ label, items }].
 */
export function reportOf(state, { includeTestCases = true } = {}) {
  const findings = [...state.findings].sort(findingOrder);
  const testCases = includeTestCases ? [...state.testCases] : [];
  const evidence = [...findings, ...testCases].reduce(
    (n, r) => n + (r.Requests ?? []).length + (r.Artifacts ?? []).length,
    0,
  );
  const gapsIn = (kind, records) =>
    ITEMS[kind]
      .filter((item) => item.required)
      .map((item) => ({
        label: item.missing,
        items: records
          .filter((record) => !item.done(record))
          .map((record) => ({ kind, record, key: item.key, label: item.missing })),
      }));
  const gapGroups = nonEmpty([...gapsIn("finding", findings), ...gapsIn("testCase", testCases)]);
  return {
    findings,
    testCases,
    severityCounts: Object.fromEntries(
      SEVERITIES.map((severity) => [severity, findings.filter((f) => f.Severity === severity).length]),
    ),
    evidence,
    gaps: gapGroups.flatMap((group) => group.items),
    gapGroups,
  };
}

// The edit session behind the finding and test case modal. Opening a record
// copies it to `draft`; New starts a blank one. Fields, linked requests and
// artifacts are all staged on the draft, and only Save writes them.

// A new record's draft, before anything is entered.
function blankOf(kind, { requestIds = [], testCaseId = null } = {}) {
  if (kind === "finding")
    return {
      Title: "",
      Severity: "Medium",
      CVSSVector: "",
      CVSSScore: 0,
      TestCaseID: testCaseId,
      WriteUp: "",
      TreatmentPlan: "",
      Requests: [...requestIds],
      Artifacts: [],
    };
  return {
    Title: "",
    Description: "",
    Category: "",
    Tags: [],
    Note: "",
    Requests: [...requestIds],
    Artifacts: [],
  };
}

// The fields a session compares, with their labels in the change list.
const FIELDS = {
  finding: [
    ["Title", "Title"],
    ["Severity", "Severity"],
    ["CVSSVector", "CVSS"],
    ["TestCaseID", "Test case"],
    ["WriteUp", "Writeup"],
    ["TreatmentPlan", "Treatment plan"],
  ],
  testCase: [
    ["Title", "Title"],
    ["Category", "Category"],
    ["Tags", "Tags"],
    ["Description", "Description"],
    ["Note", "Note"],
  ],
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const missingFrom = (list, other) => list.filter((x) => !other.includes(x));
const artifactIds = (record) => (record.Artifacts ?? []).map((a) => a.ID);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What the session's draft changed, as short phrases for the footer and
 * the close prompt: field labels, then "+1 request", "−2 artifacts" and so on.
 */
export function changesOf(session) {
  if (!session) return [];
  const { kind, original, draft } = session;
  const out = FIELDS[kind].filter(([key]) => !same(original[key], draft[key])).map(([, label]) => label);
  const counted = (word, before, after) => {
    const added = missingFrom(after, before).length;
    const removed = missingFrom(before, after).length;
    if (added) out.push(`+${plural(added, word)}`);
    if (removed) out.push(`−${plural(removed, word)}`);
  };
  counted("request", original.Requests ?? [], draft.Requests ?? []);
  counted("artifact", artifactIds(original), artifactIds(draft));
  return out;
}

/** Whether the session's draft differs from what was opened. */
export const isDirty = (session) => changesOf(session).length > 0;

/** Whether the record modal or an inline fix holds changes not yet saved. */
export const hasUnsavedEdits = (state) => Boolean((state.fix && isDirty(state.fix)) || (state.session && isDirty(state.session)));

// The fields an inline fix on each item may change. A CVSS fix carries the
// score and the severity the score sets; a requests fix only the links.
const FIX_FIELDS = {
  WriteUp: ["WriteUp"],
  TreatmentPlan: ["TreatmentPlan"],
  Note: ["Note"],
  Category: ["Category"],
  CVSSVector: ["CVSSVector", "CVSSScore", "Severity"],
  TestCaseID: ["TestCaseID"],
  Requests: [],
};

/** The key of the record's first missing required item, or null when it is Done. */
export const firstMissingOf = (kind, record) =>
  completenessOf(kind, record).items.find((item) => item.required && !item.done)?.key ?? null;

// A record as a session copies it, its lists its own.
const copyOf = (kind, record) => ({
  ...structuredClone(record),
  Requests: [...(record.Requests ?? [])],
  Artifacts: [...(record.Artifacts ?? [])],
  ...(kind === "testCase" ? { Tags: [...(record.Tags ?? [])] } : {}),
});

// A list `mine` once `theirs` moved from `base`: what left `base` leaves,
// what joined it joins, by `idOf`. Also whether that touched `mine`.
function followList(base, theirs, mine, idOf = (x) => x) {
  const ids = (list) => list.map(idOf);
  const gone = missingFrom(ids(base), ids(theirs));
  const added = theirs.filter((x) => !ids(base).includes(idOf(x)) && !ids(mine).includes(idOf(x)));
  const next = [...mine.filter((x) => !gone.includes(idOf(x))), ...added];
  return { next, touched: added.length > 0 || next.length - added.length < mine.length };
}

// The modal's session on a record that changed elsewhere to `after`: the
// original becomes `after`, every field and link the draft left as it was
// follows, and the input stays. `remote` turns "changed" when the change
// touched the input.
function rebased(session, after) {
  const { kind, original, draft } = session;
  const theirs = copyOf(kind, after);
  const next = { ...draft };
  for (const key of Object.keys(theirs))
    if (key !== "Requests" && key !== "Artifacts" && same(draft[key], original[key])) next[key] = theirs[key];
  const fieldTouched = FIELDS[kind].some(([key]) => !same(theirs[key], original[key]) && !same(theirs[key], draft[key]));
  const requests = followList(original.Requests ?? [], theirs.Requests, draft.Requests ?? []);
  const artifacts = followList(original.Artifacts ?? [], theirs.Artifacts, draft.Artifacts ?? [], (a) => a.ID);
  next.Requests = requests.next;
  next.Artifacts = artifacts.next;
  const touched = isDirty(session) && (fieldTouched || requests.touched || artifacts.touched);
  return { ...session, original: theirs, draft: next, remote: touched ? "changed" : session.remote ?? null };
}

// A session that creates `draft` again, its record deleted elsewhere: a
// new record with the draft's fields and links; uploaded artifacts went
// with the record, staged ones stay.
function recreated(kind, draft) {
  const { ID, CreatedAt, ...fields } = draft;
  return {
    kind,
    isNew: true,
    original: blankOf(kind),
    draft: { ...fields, Artifacts: (draft.Artifacts ?? []).filter((a) => a.File) },
    confirming: false,
    saving: false,
    error: null,
    remote: "deleted",
  };
}

// The state without the record of `kind` with `id`: out of its list, out
// of the workspace and its fix, and a test case out of the findings that
// named it.
function removed(state, kind, id) {
  const list = listOf(kind);
  const wasOpen = state.open?.kind === kind && state.open?.id === id;
  const fixed = state.fix?.kind === kind && state.fix?.id === id;
  return {
    ...state,
    [list]: state[list].filter((r) => r.ID !== id),
    ...(kind === "testCase"
      ? { findings: state.findings.map((f) => (sameID(f.TestCaseID, id) ? { ...f, TestCaseID: null } : f)) }
      : {}),
    open: wasOpen ? null : state.open,
    fix: fixed ? null : state.fix,
  };
}

/**
 * How long the Logbook waits after another client's bulk change
 * (traffic.changed) before reading the records it touched, so a burst reads
 * each once.
 */
export const TRAFFIC_SETTLE_MS = 300;

// The service's link target kinds as the store names them.
const TARGET_KINDS = { finding: "finding", test_case: "testCase" };

export function createLogbookStore(api, timers = globalThis) {
  const store = writable(initialState());

  // Reads race the changes applied here, so one clock orders both. Each
  // local change to a record (an event, a bulk delete, this app's own
  // write) stamps it in `changed`; each read takes a tick as it starts
  // (`lastRead` per record, `listRead` for the lists). A read's snapshot of
  // a record applies only when nothing changed the record and no newer read
  // of it started since. A deletion also stamps `deleted`: a record missing
  // here is gone only when deleted after the read started, else not loaded
  // yet, and the read adds it. `clear` starts a new `epoch`, dropping every
  // read.
  let clock = 0;
  let epoch = 0;
  let listRead = 0;
  const changed = new Map();
  const deleted = new Map();
  const lastRead = new Map();
  const keyOf = (kind, id) => `${kind} ${id}`;
  const touch = (kind, id) => changed.set(keyOf(kind, id), ++clock);
  const tombstone = (kind, id) => {
    touch(kind, id);
    deleted.set(keyOf(kind, id), clock);
  };
  const changedSince = (kind, id, at) => (changed.get(keyOf(kind, id)) ?? 0) > at;
  const deletedSince = (kind, id, at) => (deleted.get(keyOf(kind, id)) ?? 0) > at;
  const newerRead = (kind, id, at) => Math.max(listRead, lastRead.get(keyOf(kind, id)) ?? 0) > at;

  /**
   * Reads the project's findings and test cases. A record changed here
   * while the lists were on their way keeps its change and is read again.
   */
  async function populate() {
    const at = (listRead = ++clock);
    const started = epoch;
    const [findings, testCases] = await Promise.all([api.listFindings(), api.listTestCases()]);
    if (started !== epoch || listRead !== at) return;
    store.update((state) =>
      refreshFix({
        ...state,
        findings: mergedRead("finding", at, findings ?? [], state.findings),
        testCases: mergedRead("testCase", at, testCases ?? [], state.testCases),
      }),
    );
  }

  // The list read at `at` over the `local` one: the read's record where
  // nothing changed it since, else the local record, or the read's when
  // none is listed and no deletion followed the read. A record changed
  // since is read again.
  function mergedRead(kind, at, read, local) {
    const fresh = (id) => !changedSince(kind, id, at) && !newerRead(kind, id, at);
    const localOf = new Map(local.map((r) => [String(r.ID), r]));
    const readIds = new Set(read.map((r) => String(r.ID)));
    const kept = (r) => (fresh(r.ID) ? r : (localOf.get(String(r.ID)) ?? (deletedSince(kind, r.ID, at) ? null : r)));
    const next = read.flatMap((r) => kept(r) ?? []);
    const added = local.filter((r) => !readIds.has(String(r.ID)) && !fresh(r.ID));
    for (const r of [...next, ...added]) if (changedSince(kind, r.ID, at)) markStale(kind, r.ID);
    return [...added, ...next];
  }

  // Reads the "finding" or "testCase" with `id` again and applies it by
  // `apply(record)` under the clock's rule. A read a local change overtook
  // asks again once traffic settles; one a newer read or a deletion
  // overtook is dropped.
  async function reread(kind, id, apply) {
    const at = ++clock;
    const started = epoch;
    lastRead.set(keyOf(kind, id), at);
    const record = await (kind === "finding" ? api.getFinding(id) : api.getTestCase(id));
    if (started !== epoch || newerRead(kind, id, at) || deletedSince(kind, id, at)) return;
    if (changedSince(kind, id, at)) markStale(kind, id);
    else apply(record);
  }

  /**
   * Reads the lists again after a stream reset (expired or invalid): the
   * records are replaced, while the filters, the open record, the modal's
   * edit session and an inline fix with input stay.
   */
  const resync = populate;

  /** Reads the "finding" or "testCase" with `id` again, such as before Edit. */
  async function reload(kind, id) {
    await reread(kind, id, (record) => keep(kind, record, { read: true }));
  }

  // Changes one record's linked requests in its list.
  const relink = (kind, id, change) =>
    store.update((state) => {
      touch(kind, id);
      const list = kind === "finding" ? "findings" : "testCases";
      return refreshFix({
        ...state,
        [list]: state[list].map((r) => (r.ID === id ? { ...r, Requests: change(r.Requests ?? []) } : r)),
      });
    });

  /**
   * Links the request to the "finding" or "testCase" at once, outside an
   * edit session, as the Ledger's finding and test case menus do.
   */
  async function linkNow(kind, id, request) {
    await BINDINGS[kind].link(id, request);
    relink(kind, id, (requests) => (requests.includes(request) ? requests : [...requests, request]));
  }

  /** Unlinks the request from the "finding" or "testCase" at once. */
  async function unlinkNow(kind, id, request) {
    await BINDINGS[kind].unlink(id, request);
    relink(kind, id, (requests) => requests.filter((r) => r !== request));
  }

  /**
   * Replaces the findings ("finding") or test cases ("testCase") with a
   * list written elsewhere, keeping the filters.
   */
  const setRecords = (kind, records) =>
    store.update((state) =>
      refreshFix({
        ...state,
        [kind === "finding" ? "findings" : "testCases"]: records ?? [],
      }),
    );

  // Forgets the project's records and the Logbook's filters, and ignores
  // lists still on their way, before another project opens.
  function clear() {
    epoch++;
    listRead = 0;
    changed.clear();
    deleted.clear();
    lastRead.clear();
    pending = null;
    stale.clear();
    timers.clearTimeout(staleTimer);
    staleTimer = null;
    store.set(initialState());
  }

  // The move away an unsaved inline fix is holding until Discard.
  let pending = null;

  // Runs `move` at once unless an inline fix has unsaved input; then the fix
  // asks first (leaving) and Discard runs it. Returns whether it ran.
  function guarded(move) {
    const fix = get(store).fix;
    if (fix && isDirty(fix)) {
      pending = move;
      store.update((state) => ({ ...state, fix: { ...state.fix, leaving: true } }));
      return false;
    }
    pending = null;
    move();
    return true;
  }

  let fixSeq = 0;
  const fixOf = (kind, record, item, { focus = false, auto = false, seq = ++fixSeq } = {}) => {
    const copy = copyOf(kind, record);
    return {
      kind,
      id: record.ID,
      item,
      isNew: false,
      original: copy,
      draft: structuredClone(copy),
      focus,
      auto,
      seq,
      leaving: false,
      saving: false,
      error: null,
    };
  };

  // The fix a record opens on: `item` when asked for, else its first
  // missing required item, or none when it is Done.
  function arrivalFix(state, kind, id, item) {
    const record = recordsOf(state, kind).find((r) => r.ID === id);
    const at = record && (item ?? firstMissingOf(kind, record));
    return at ? fixOf(kind, record, at, { auto: true }) : null;
  }

  // After the lists change, a fix with no input follows its record: an
  // automatic one moves on from an item that is now filled.
  function refreshFix(state) {
    const fix = state.fix;
    if (!fix || fix.saving || isDirty(fix)) return state;
    const record = recordsOf(state, fix.kind).find((r) => r.ID === fix.id);
    if (!record || !state.open) return { ...state, fix: null };
    const filledNow = ITEMS[fix.kind].find((i) => i.key === fix.item)?.done(record);
    const item = fix.auto && filledNow ? firstMissingOf(fix.kind, record) : fix.item;
    if (!item) return { ...state, fix: null };
    return { ...state, fix: fixOf(fix.kind, record, item, { focus: false, auto: fix.auto, seq: item === fix.item ? fix.seq : ++fixSeq }) };
  }

  // Any change to the filters closes the open record, back to the list.
  function setFilters(change) {
    const before = get(store).filters;
    const filters = change(before);
    if (JSON.stringify(filters) === JSON.stringify(before)) return;
    guarded(() => store.update((state) => ({ ...state, filters, open: null, fix: null })));
  }

  /**
   * Opens the record in the workspace, with its inline fix on the item
   * `focus` (an ITEMS key, such as a missing one the export review points
   * to) when given, else on its first missing required item. Asks first
   * while an inline fix has unsaved input.
   */
  const open = (kind, id, focus = null) =>
    guarded(() =>
      store.update((state) => ({ ...state, open: { kind, id, focus }, fix: arrivalFix(state, kind, id, focus) })),
    );

  /** Closes the open record, back to the list. Asks first like open. */
  const close = () => guarded(() => store.update((state) => ({ ...state, open: null, fix: null })));

  /**
   * Opens the record Next goes to and returns it, or null when there is
   * none or an unsaved inline fix asks first.
   */
  function openNext() {
    const target = nextOf(get(store));
    if (!target) return null;
    return open(target.kind, target.record.ID) ? target : null;
  }

  /** Sets the search text. */
  const setQuery = (q) => setFilters((filters) => ({ ...filters, q }));

  /** Lists "all", only In progress ("progress") or only "done" records. */
  const setStatus = (status) => setFilters((filters) => ({ ...filters, status }));

  /**
   * Shows "all", "findings" or "testCases", and drops the filters that
   * don't apply to it. "all" drops them all, since each narrows to one
   * kind. A kind other than "all" counts as chosen by hand.
   */
  const setKind = (kind) =>
    setFilters((filters) => ({
      ...filters,
      kind,
      manualKind: kind !== "all",
      severities: kind === "findings" ? filters.severities : [],
      categories: kind === "testCases" ? filters.categories : [],
      tags: kind === "testCases" ? filters.tags : [],
    }));

  // The kind once the contextual filters are cleared: both, unless the
  // tester chose it.
  const unnarrowed = (filters) => (filters.manualKind ? filters.kind : "all");

  /**
   * Filters findings by severity. Any severity narrows the kind to
   * findings and clears the category and tag filters.
   */
  const setSeverities = (severities) =>
    setFilters((filters) =>
      severities.length
        ? { ...filters, severities, categories: [], tags: [], kind: "findings" }
        : { ...filters, severities, kind: unnarrowed(filters) },
    );

  // A category or tag narrows the kind to test cases and clears the
  // severity filter.
  const setTestCaseFilter = (patch) =>
    setFilters((filters) => {
      const next = { ...filters, ...patch };
      return next.categories.length || next.tags.length
        ? { ...next, severities: [], kind: "testCases" }
        : { ...next, kind: unnarrowed(filters) };
    });

  /** Filters test cases by category ("Uncategorized" for none). */
  const setCategories = (categories) => setTestCaseFilter({ categories });

  /** Filters test cases to those with any of the tags. */
  const setTags = (tags) => setTestCaseFilter({ tags });

  /** Clears the search and every filter. */
  const clearFilters = () => setFilters(() => initialFilters());

  /** Groups "findings" or "testCases" `by` one of the ways grouping allows. */
  const setGrouping = (list, by) =>
    store.update((state) => ({ ...state, grouping: { ...state.grouping, [list]: by } }));

  const setSession = (session) => store.update((state) => ({ ...state, session }));

  function begin(kind, original) {
    setSession({
      kind,
      isNew: !original.ID,
      original,
      draft: structuredClone(original),
      confirming: false,
      saving: false,
      error: null,
    });
  }

  /**
   * Starts a new "finding" or "testCase" in the edit session, pre-filled
   * with `requestIds` and, for a finding, `testCaseId`. Nothing is created
   * until Save.
   */
  const startNew = (kind, preset) => begin(kind, blankOf(kind, preset));

  /** Opens the "finding" or "testCase" with `id` in the edit session. */
  function edit(kind, id) {
    const record = recordsOf(get(store), kind).find((r) => r.ID === id);
    if (!record) return;
    begin(kind, copyOf(kind, record));
  }

  // The modal's session sits in the "session" slot and an inline fix in
  // "fix"; both stage on a draft and save through the same path.

  // Changes the draft in `slot` with `change(draft)`.
  const updateIn = (slot, change) =>
    store.update((state) =>
      state[slot] ? { ...state, [slot]: { ...state[slot], draft: change(state[slot].draft) } } : state,
    );
  const updateSession = (change) => updateIn("session", change);

  // On a finding, a new score with a vector sets the severity, as the old
  // finding modal did.
  const patchDraft = (slot, patch) =>
    store.update((state) => {
      const session = state[slot];
      if (!session) return state;
      const draft = { ...session.draft, ...patch };
      if (session.kind === "finding" && "CVSSScore" in patch && patch.CVSSScore !== session.draft.CVSSScore && draft.CVSSVector)
        draft.Severity = severityFromScore(draft.CVSSScore) ?? draft.Severity;
      return { ...state, [slot]: { ...session, draft } };
    });

  const linkIn = (slot, id) =>
    updateIn(slot, (draft) => (draft.Requests.includes(id) ? draft : { ...draft, Requests: [...draft.Requests, id] }));
  const unlinkIn = (slot, id) => updateIn(slot, (draft) => ({ ...draft, Requests: draft.Requests.filter((r) => r !== id) }));

  /**
   * Changes fields on the draft. On a finding, a new score with a vector
   * sets the severity, as the old finding modal did.
   */
  const updateDraft = (patch) => patchDraft("session", patch);

  /** Stages a link to the request with `id`. */
  const linkRequest = (id) => linkIn("session", id);

  /** Stages unlinking the request with `id`. */
  const unlinkRequest = (id) => unlinkIn("session", id);

  let stagedSeq = 0;

  /** Stages `files` (File objects) to upload on Save. */
  const addArtifacts = (files) =>
    updateSession((draft) => ({
      ...draft,
      Artifacts: [
        ...draft.Artifacts,
        ...Array.from(files).map((file) => ({
          ID: `staged-${++stagedSeq}`,
          Filename: file.name,
          MimeType: file.type || "application/octet-stream",
          Size: file.size,
          File: file,
        })),
      ],
    }));

  /** Stages removing the artifact with `id`; a staged one just goes. */
  const removeArtifact = (id) =>
    updateSession((draft) => ({ ...draft, Artifacts: draft.Artifacts.filter((a) => a.ID !== id) }));

  /** Takes back removing the record's artifact with `id`. */
  const restoreArtifact = (id) =>
    store.update((state) => {
      const session = state.session;
      const artifact = session?.original.Artifacts.find((a) => a.ID === id);
      if (!artifact || session.draft.Artifacts.some((a) => a.ID === id)) return state;
      return { ...state, session: { ...session, draft: { ...session.draft, Artifacts: [...session.draft.Artifacts, artifact] } } };
    });

  const patchIn = (slot, patch) =>
    store.update((state) => (state[slot] ? { ...state, [slot]: { ...state[slot], ...patch } } : state));
  const patchSession = (patch) => patchIn("session", patch);

  /** Closes the session without saving. Makes no calls. */
  const discard = () => setSession(null);

  /**
   * X, Esc and a click outside: closes a clean session at once
   * ("closed") and asks on a dirty one ("confirm").
   */
  function requestClose() {
    const session = get(store).session;
    if (!session) return "closed";
    if (!isDirty(session)) {
      discard();
      return "closed";
    }
    patchSession({ confirming: true });
    return "confirm";
  }

  /** Dismisses the close prompt, back to the draft. */
  const keepEditing = () => patchSession({ confirming: false });

  // Puts the saved (or, with `read`, the reread) record in its list,
  // replacing the old copy.
  const keep = (kind, record, { read = false } = {}) =>
    store.update((state) => {
      if (!read) touch(kind, record.ID);
      const list = kind === "finding" ? "findings" : "testCases";
      const others = state[list].filter((r) => r.ID !== record.ID);
      const exists = others.length < state[list].length;
      const next = exists ? state[list].map((r) => (r.ID === record.ID ? record : r)) : [record, ...others];
      return refreshFix({ ...state, [list]: next });
    });

  // Changes written elsewhere (logbookEvents.js). Each updates the lists,
  // then the edit session and inline fix on that record follow it.

  // Records this app is deleting: their deleted events are its own.
  const deleting = new Set();

  // The modal's session and an inline fix with input, once the record of
  // `kind` with `id` went from `before` to `after` (null when deleted)
  // elsewhere. The researcher's input stays; what they left follows the
  // change. `remote` says what happened: "changed" when the change touched
  // input, "deleted" when the record went (Save then creates it again).
  function followed(state, kind, id, before, after) {
    let { session, fix } = state;
    const mine = (slot) => slot && slot.kind === kind && sameID(slot.original?.ID ?? slot.id, id);
    if (mine(session) && !session.isNew && !session.saving && !deleting.has(id))
      session = after ? rebased(session, after) : recreated(kind, session.draft);
    if (mine(fix) && isDirty(fix) && !fix.saving && !deleting.has(id)) {
      if (after) {
        const touched = FIX_FIELDS[fix.item].some((key) => !same(after[key], fix.original[key]) && !same(after[key], fix.draft[key]));
        if (touched) fix = { ...fix, remote: "changed" };
      } else if (!session) {
        // The record view closes with it, so its input moves to the modal.
        const picked = Object.fromEntries(FIX_FIELDS[fix.item].map((key) => [key, fix.draft[key]]));
        session = recreated(kind, { ...copyOf(kind, before), ...picked, Requests: [...fix.draft.Requests] });
      }
    }
    return { ...state, session, fix };
  }

  /**
   * A "finding" or "testCase" another client (or this one) created or
   * changed: `fields` over the listed record, keeping its links and
   * artifacts, or a new record with none.
   */
  const applyRecord = (kind, fields) =>
    patchRecord(kind, fields.ID, (old) => ({ Requests: [], Artifacts: [], ...old, ...fields }), { create: true });

  /** A "finding" or "testCase" deleted elsewhere leaves the lists, as Delete does. */
  function applyDeleted(kind, id) {
    const state = get(store);
    const before = recordsOf(state, kind).find((r) => sameID(r.ID, id));
    if (state.fix?.kind === kind && state.fix?.id === id) pending = null;
    tombstone(kind, id);
    store.update((s) => removed(before ? followed(s, kind, id, before, null) : s, kind, id));
  }

  // Changes the record of `kind` with `id` in its list by `change(record)`,
  // or with `create` adds `change(undefined)` when it is not listed. A
  // change stamps the record, unless it is a reread's snapshot (`read`).
  const patchRecord = (kind, id, change, { create = false, read = false } = {}) =>
    store.update((state) => {
      const list = listOf(kind);
      const before = state[list].find((r) => sameID(r.ID, id));
      if (!before && !create) return state;
      if (!read) touch(kind, id);
      const after = change(before);
      const next = before ? state[list].map((r) => (r === before ? after : r)) : [after, ...state[list]];
      const moved = { ...state, [list]: next };
      return refreshFix(before ? followed(moved, kind, id, before, after) : moved);
    });

  /** A request linked to (`linked` true) or unlinked from a record elsewhere. */
  const applyLink = (kind, id, request, isLinked) =>
    patchRecord(kind, id, (r) => {
      const requests = (r.Requests ?? []).filter((x) => x !== request);
      return { ...r, Requests: isLinked ? [...requests, request] : requests };
    });

  // The records a bulk change touched, read again once the burst settles:
  // "kind id" -> [kind, id].
  const stale = new Map();
  let staleTimer = null;

  function markStale(kind, id) {
    stale.set(`${kind} ${id}`, [kind, id]);
    timers.clearTimeout(staleTimer);
    staleTimer = timers.setTimeout(readStale, TRAFFIC_SETTLE_MS);
  }

  function readStale() {
    staleTimer = null;
    const records = [...stale.values()];
    stale.clear();
    for (const [kind, id] of records)
      reread(kind, id, (record) => patchRecord(kind, id, () => record, { create: true, read: true })).catch((err) =>
        console.error(`Rereading ${kind} ${id} failed:`, err),
      );
  }

  /**
   * A bulk change to traffic (traffic.changed), from any client. A link or
   * unlink rereads its finding or test case. A delete drops the selection's
   * ids from the records' links, or, for a query, rereads every linked
   * record. The reads follow through `followed`, so an open edit keeps its
   * input.
   */
  function applyTrafficChanged({ change, selection, target } = {}) {
    if (change === "link" || change === "unlink") {
      const kind = TARGET_KINDS[target?.kind];
      if (kind) markStale(kind, target.id);
      return;
    }
    if (change !== "delete") return;
    const ids = Array.isArray(selection?.ids) ? selection.ids.map(String) : null;
    for (const kind of ["finding", "testCase"])
      for (const r of recordsOf(get(store), kind)) {
        const requests = r.Requests ?? [];
        if (!ids) {
          if (requests.length) markStale(kind, r.ID);
        } else if (requests.some((x) => ids.includes(String(x)))) {
          patchRecord(kind, r.ID, (rec) => ({ ...rec, Requests: requests.filter((x) => !ids.includes(String(x))) }));
        }
      }
  }

  /** An artifact uploaded elsewhere joins its finding or test case. */
  function applyArtifact(artifact) {
    const [kind, owner] = artifact.FindingID ? ["finding", artifact.FindingID] : ["testCase", artifact.TestCaseID];
    patchRecord(kind, owner, (r) => {
      const others = (r.Artifacts ?? []).filter((a) => a.ID !== artifact.ID);
      return { ...r, Artifacts: [...others, artifact] };
    });
  }

  /** An artifact deleted elsewhere leaves whichever record held it. */
  function applyArtifactRemoved(id) {
    for (const kind of ["finding", "testCase"])
      for (const r of recordsOf(get(store), kind))
        if ((r.Artifacts ?? []).some((a) => a.ID === id))
          patchRecord(kind, r.ID, (rec) => ({ ...rec, Artifacts: rec.Artifacts.filter((a) => a.ID !== id) }));
  }

  const BINDINGS = {
    finding: {
      create: (draft) => api.createDraftFinding(draft.Requests, draft.TestCaseID ?? null),
      save: (record) => api.saveFinding(record),
      link: (id, request) => api.linkRequestToFinding(id, request),
      unlink: (id, request) => api.unlinkRequestFromFinding(id, request),
      upload: (id, file) => api.saveArtifactToFinding(id, file),
      deleteArtifact: (id) => api.deleteArtifact(id),
      delete: (id) => api.deleteFinding(id),
    },
    testCase: {
      create: (draft) => api.createDraftTestCase(draft.Requests),
      save: (record) => api.saveTestCase(record),
      link: (id, request) => api.linkRequestToTestCase(id, request),
      unlink: (id, request) => api.unlinkRequestFromTestCase(id, request),
      upload: (id, file) => api.saveArtifactToTestCase(id, file),
      deleteArtifact: (id) => api.deleteArtifact(id),
      delete: (id) => api.deleteTestCase(id),
    },
  };

  /**
   * Deletes the "finding" or "testCase" with `id`. On success it leaves the
   * list, its fix is dropped and, when open, the Logbook goes back to the
   * list: { ok: true }. A failed call changes nothing: { ok: false, error }.
   */
  async function deleteRecord(kind, id) {
    deleting.add(id);
    try {
      await BINDINGS[kind].delete(id);
    } catch (error) {
      return { ok: false, error };
    } finally {
      deleting.delete(id);
    }
    if (get(store).fix?.kind === kind && get(store).fix?.id === id) pending = null;
    tombstone(kind, id);
    store.update((state) => removed(state, kind, id));
    return { ok: true };
  }

  /**
   * Writes the draft with the existing bindings, in order. A new record:
   * create (with its requests and test case), save the fields, upload the
   * artifacts. A record: save the fields, link and unlink each changed
   * request, upload and delete each changed artifact. Resolves to
   * { ok: true, kind, id, created, done } and closes the session, done true
   * when the save made the record Done; { ok: false,
   * reason: "title" } with an empty title, making no calls; or { ok: false,
   * error } when a call fails, keeping the session with what is still
   * unsaved, so Save again carries on from there.
   */
  const save = () => saveIn("session");

  async function saveIn(slot) {
    const session = get(store)[slot];
    if (!session || session.saving) return { ok: false, reason: "busy" };
    if (!session.draft.Title?.trim()) return { ok: false, reason: "title" };
    const { kind } = session;
    const calls = BINDINGS[kind];
    let { original, draft } = session;
    // Each call that succeeds moves the original on, so the session's
    // changes are always what is still unsaved.
    const advance = (patch, draftPatch = {}) => {
      original = { ...original, ...patch };
      draft = { ...draft, ...draftPatch };
      patchIn(slot, { original, draft });
    };
    patchIn(slot, { saving: true, error: null, confirming: false });
    // Every call goes to the connection the save began on (boundAction.js).
    const action = boundAction(api.bind?.());
    try {
      if (!original.ID) {
        const created = await action.step(() => calls.create(draft));
        const placed = { ID: created.ID, CreatedAt: created.CreatedAt };
        advance({ ...placed, Requests: [...draft.Requests], TestCaseID: draft.TestCaseID }, placed);
      }
      if (FIELDS[kind].some(([key]) => !same(original[key], draft[key]))) {
        await action.step(() => calls.save({ ...draft, Requests: original.Requests, Artifacts: undefined }));
        // Every field went, the score with the vector among them.
        const { Requests, Artifacts, ...fields } = draft;
        advance(fields);
      }
      for (const request of missingFrom(draft.Requests, original.Requests)) {
        await action.step(() => calls.link(original.ID, request));
        advance({ Requests: [...original.Requests, request] });
      }
      for (const request of missingFrom(original.Requests, draft.Requests)) {
        await action.step(() => calls.unlink(original.ID, request));
        advance({ Requests: original.Requests.filter((r) => r !== request) });
      }
      for (const staged of draft.Artifacts.filter((a) => a.File)) {
        const uploaded = await action.step(() => calls.upload(original.ID, staged.File));
        advance(
          { Artifacts: [...original.Artifacts, uploaded] },
          { Artifacts: draft.Artifacts.map((a) => (a.ID === staged.ID ? uploaded : a)) },
        );
      }
      for (const id of missingFrom(artifactIds(original), artifactIds(draft))) {
        await action.step(() => calls.deleteArtifact(id));
        advance({ Artifacts: original.Artifacts.filter((a) => a.ID !== id) });
      }
    } catch (error) {
      // A connection switch stopped the save: nothing to report.
      if (isSuperseded(error)) {
        patchIn(slot, { saving: false });
        return { ok: false, reason: "superseded" };
      }
      patchIn(slot, { saving: false, error });
      return { ok: false, error };
    }
    keep(kind, original);
    store.update((state) => ({ ...state, [slot]: null }));
    const done = completenessOf(kind, original).status === "done" && completenessOf(kind, session.original).status !== "done";
    return { ok: true, kind, id: original.ID, created: session.isNew, done };
  }

  // Inline fixes: one item of the open record, staged in the "fix" slot.

  /**
   * Opens a fix on the open record's `item` and focuses it, as Add or
   * edit do. Asks first while a fix on another item has unsaved input.
   */
  function startFix(item) {
    const state = get(store);
    if (!state.open) return false;
    if (state.fix?.item === item) {
      patchIn("fix", { focus: true, auto: false, seq: ++fixSeq });
      return true;
    }
    const record = recordsOf(state, state.open.kind).find((r) => r.ID === state.open.id);
    if (!record) return false;
    return guarded(() =>
      store.update((s) => ({ ...s, fix: fixOf(state.open.kind, record, item, { focus: true }) })),
    );
  }

  /** Changes the fix's fields; a CVSS score sets the severity as in the modal. */
  const updateFix = (patch) => patchDraft("fix", patch);

  /** Stages a link to the request with `id` on the fix. */
  const linkFixRequest = (id) => linkIn("fix", id);

  /** Stages unlinking the request with `id` on the fix. */
  const unlinkFixRequest = (id) => unlinkIn("fix", id);

  /** Cancel: drops the fix with no calls. */
  function cancelFix() {
    pending = null;
    store.update((state) => ({ ...state, fix: null }));
  }

  /** Keep editing: the move away waiting on the fix is dropped. */
  function keepFix() {
    pending = null;
    // A fresh filters object puts the search box back to the search in use.
    store.update((state) => ({ ...state, filters: { ...state.filters }, fix: state.fix && { ...state.fix, leaving: false } }));
  }

  /** Discard: drops the fix, then makes the move away it was holding. */
  function discardFix() {
    const move = pending;
    cancelFix();
    move?.();
  }

  /**
   * Saves the fix through Save, with only its item's changes laid over the
   * record as it is now, so a change saved elsewhere meanwhile stays. Then
   * the record's next missing required item opens. Resolves to Save's
   * result plus `done`, true when the record just became Done; a failure
   * keeps the fix and its input.
   */
  async function saveFix() {
    const state = get(store);
    const fix = state.fix;
    if (!fix || fix.saving) return { ok: false, reason: "busy" };
    const record = recordsOf(state, fix.kind).find((r) => r.ID === fix.id);
    if (!record) {
      cancelFix();
      return { ok: false, reason: "gone" };
    }
    const wasDone = completenessOf(fix.kind, record).status === "done";
    const original = copyOf(fix.kind, record);
    const draft = { ...structuredClone(original), ...Object.fromEntries(FIX_FIELDS[fix.item].map((key) => [key, fix.draft[key]])) };
    const added = missingFrom(fix.draft.Requests, fix.original.Requests);
    const removed = missingFrom(fix.original.Requests, fix.draft.Requests);
    draft.Requests = [...original.Requests.filter((r) => !removed.includes(r)), ...missingFrom(added, original.Requests)];
    patchIn("fix", { original, draft, leaving: false });
    pending = null;
    const result = await saveIn("fix");
    if (!result.ok) return result;
    const saved = recordsOf(get(store), fix.kind).find((r) => r.ID === fix.id);
    const done = !!saved && completenessOf(fix.kind, saved).status === "done";
    const next = saved && firstMissingOf(fix.kind, saved);
    const stillOpen = get(store).open?.kind === fix.kind && get(store).open?.id === fix.id;
    if (next && stillOpen) store.update((s) => ({ ...s, fix: fixOf(fix.kind, saved, next, { focus: true, auto: true }) }));
    return { ...result, done: done && !wasDone };
  }

  return {
    subscribe: store.subscribe,
    save,
    discard,
    requestClose,
    keepEditing,
    startNew,
    edit,
    updateDraft,
    linkRequest,
    unlinkRequest,
    addArtifacts,
    removeArtifact,
    restoreArtifact,
    startFix,
    updateFix,
    linkFixRequest,
    unlinkFixRequest,
    saveFix,
    cancelFix,
    keepFix,
    discardFix,
    // Runs a move away from the open record, such as Edit, unless an
    // inline fix has unsaved input; then the fix asks first. Returns
    // whether it ran.
    guard: guarded,
    deleteRecord,
    // Evidence reads: a linked pair in full, an artifact with its bytes
    // (Data), and saving an artifact through the native Save dialog (false
    // when cancelled).
    readPair: (id) => api.getPair(id),
    readArtifact: (id) => api.getArtifact(id),
    downloadArtifact: (id) => api.downloadArtifact(id),
    // Report export: the template names, restoring the default template,
    // and rendering a report and saving it (false when cancelled).
    listTemplates: () => api.listTemplates(),
    restoreDefaultTemplate: () => api.restoreDefaultTemplate(),
    exportReport: (template, metadata) => api.exportReport(template, metadata),
    linkNow,
    unlinkNow,
    applyRecord,
    applyDeleted,
    applyLink,
    applyArtifact,
    applyArtifactRemoved,
    applyTrafficChanged,
    reload,
    resync,
    populate,
    clear,
    setRecords,
    setQuery,
    setStatus,
    setKind,
    setSeverities,
    setCategories,
    setTags,
    clearFilters,
    setGrouping,
    open,
    close,
    openNext,
  };
}
