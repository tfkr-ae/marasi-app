// The Logbook store: the project's findings and test cases, what each still
// needs before the report, and how the Logbook lists them. Every backend
// call goes through the injected `api` (see logbookStore.js for the Wails
// one), so this module loads under node --test.
import { get, writable } from "svelte/store";

const filled = (text) => !!text?.trim();
const linked = (record) => (record.Requests ?? []).length > 0;

/**
 * The items each kind of record has, in the order a reviewer reads them.
 * A record is Done when every required item is filled.
 */
export const ITEMS = {
  finding: [
    { key: "WriteUp", label: "Writeup", required: true, done: (r) => filled(r.WriteUp) },
    { key: "CVSSVector", label: "CVSS score", required: true, done: (r) => filled(r.CVSSVector) },
    { key: "TreatmentPlan", label: "Treatment plan", required: true, done: (r) => filled(r.TreatmentPlan) },
    { key: "Requests", label: "Linked requests", required: true, done: linked },
    { key: "TestCaseID", label: "Test case", required: false, done: (r) => !!r.TestCaseID },
  ],
  testCase: [
    { key: "Note", label: "Note", required: true, done: (r) => filled(r.Note) },
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
  // "tag" or "none". open: the record in the workspace as { kind, id },
  // kind "finding" or "testCase", or null while the list shows.
  return {
    findings: [],
    testCases: [],
    filters: initialFilters(),
    grouping: { findings: "severity", testCases: "category" },
    open: null,
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

/** The open record as { kind, record }, or null when the list shows. */
export function openRecordOf(state) {
  if (!state.open) return null;
  const record = recordsOf(state, state.open.kind).find((r) => r.ID === state.open.id);
  return record ? { kind: state.open.kind, record } : null;
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

export function createLogbookStore(api) {
  const store = writable(initialState());
  // Each read of the lists gets a number; an older reply is ignored.
  let readSeq = 0;

  /** Reads the project's findings and test cases. */
  async function populate() {
    const seq = ++readSeq;
    const [findings, testCases] = await Promise.all([api.listFindings(), api.listTestCases()]);
    if (seq !== readSeq) return;
    store.update((state) => ({ ...state, findings: findings ?? [], testCases: testCases ?? [] }));
  }

  /**
   * Replaces the findings ("finding") or test cases ("testCase") with a
   * list written elsewhere, such as by today's finding and test case
   * modals, keeping the filters.
   */
  const setRecords = (kind, records) =>
    store.update((state) => ({
      ...state,
      [kind === "finding" ? "findings" : "testCases"]: records ?? [],
    }));

  // Forgets the project's records and the Logbook's filters, and ignores
  // lists still on their way, before another project opens.
  function clear() {
    readSeq++;
    store.set(initialState());
  }

  // Any change to the filters closes the open record, back to the list.
  const setFilters = (change) =>
    store.update((state) => {
      const filters = change(state.filters);
      const changed = JSON.stringify(filters) !== JSON.stringify(state.filters);
      return changed ? { ...state, filters, open: null } : state;
    });

  /** Opens the record in the workspace. */
  const open = (kind, id) => store.update((state) => ({ ...state, open: { kind, id } }));

  /** Closes the open record, back to the list. */
  const close = () => store.update((state) => ({ ...state, open: null }));

  /** Opens the record Next goes to and returns it, or null when there is none. */
  function openNext() {
    const target = nextOf(get(store));
    if (target) open(target.kind, target.record.ID);
    return target;
  }

  /** Sets the search text. */
  const setQuery = (q) => setFilters((filters) => ({ ...filters, q }));

  /** Lists "all", only In progress ("progress") or only "done" records. */
  const setStatus = (status) => setFilters((filters) => ({ ...filters, status }));

  /**
   * Shows "all", "findings" or "testCases", and drops the filters that
   * don't apply to it. A kind other than "all" counts as chosen by hand.
   */
  const setKind = (kind) =>
    setFilters((filters) => ({
      ...filters,
      kind,
      manualKind: kind !== "all",
      severities: kind === "testCases" ? [] : filters.severities,
      categories: kind === "findings" ? [] : filters.categories,
      tags: kind === "findings" ? [] : filters.tags,
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

  return {
    subscribe: store.subscribe,
    // Evidence reads: a linked pair in full (GetRawDetails), an artifact
    // with its bytes (GetArtifact), and saving an artifact through the
    // native Save dialog (DownloadArtifact, false when cancelled).
    readPair: (id) => api.getPair(id),
    readArtifact: (id) => api.getArtifact(id),
    downloadArtifact: (id) => api.downloadArtifact(id),
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
