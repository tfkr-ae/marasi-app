// The Logbook store: the project's findings and test cases, what each still
// needs before the report, and how the Logbook lists them. Every backend
// call goes through the injected `api` (see logbookStore.js for the Wails
// one), so this module loads under node --test.
import { get, writable } from "svelte/store";
import { severityFromScore } from "../lib/severity.js";

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
 * severity then score, test cases as ListTestCases gives them (none when
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

  /**
   * Opens the record in the workspace, at the item `focus` (an ITEMS key,
   * such as a missing one the export review points to) when given.
   */
  const open = (kind, id, focus = null) =>
    store.update((state) => ({ ...state, open: { kind, id, focus } }));

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
    begin(kind, {
      ...structuredClone(record),
      Requests: [...(record.Requests ?? [])],
      Artifacts: [...(record.Artifacts ?? [])],
      ...(kind === "testCase" ? { Tags: [...(record.Tags ?? [])] } : {}),
    });
  }

  // Changes the open session's draft with `change(draft)`.
  const updateSession = (change) =>
    store.update((state) =>
      state.session ? { ...state, session: { ...state.session, draft: change(state.session.draft) } } : state,
    );

  /**
   * Changes fields on the draft. On a finding, a new score with a vector
   * sets the severity, as the old finding modal did.
   */
  const updateDraft = (patch) =>
    store.update((state) => {
      const session = state.session;
      if (!session) return state;
      const draft = { ...session.draft, ...patch };
      if (session.kind === "finding" && "CVSSScore" in patch && patch.CVSSScore !== session.draft.CVSSScore && draft.CVSSVector)
        draft.Severity = severityFromScore(draft.CVSSScore) ?? draft.Severity;
      return { ...state, session: { ...session, draft } };
    });

  /** Stages a link to the request with `id`. */
  const linkRequest = (id) =>
    updateSession((draft) => (draft.Requests.includes(id) ? draft : { ...draft, Requests: [...draft.Requests, id] }));

  /** Stages unlinking the request with `id`. */
  const unlinkRequest = (id) => updateSession((draft) => ({ ...draft, Requests: draft.Requests.filter((r) => r !== id) }));

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

  const patchSession = (patch) =>
    store.update((state) => (state.session ? { ...state, session: { ...state.session, ...patch } } : state));

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

  // Puts the saved record in its list, replacing the old copy.
  const keep = (kind, record) =>
    store.update((state) => {
      const list = kind === "finding" ? "findings" : "testCases";
      const others = state[list].filter((r) => r.ID !== record.ID);
      const exists = others.length < state[list].length;
      const next = exists ? state[list].map((r) => (r.ID === record.ID ? record : r)) : [record, ...others];
      return { ...state, [list]: next };
    });

  const BINDINGS = {
    finding: {
      create: (draft) => api.createDraftFinding(draft.Requests, draft.TestCaseID ?? null),
      save: (record) => api.saveFinding(record),
      link: (id, request) => api.linkRequestToFinding(id, request),
      unlink: (id, request) => api.unlinkRequestFromFinding(id, request),
      upload: (id, file) => api.saveArtifactToFinding(id, file),
    },
    testCase: {
      create: (draft) => api.createDraftTestCase(draft.Requests),
      save: (record) => api.saveTestCase(record),
      link: (id, request) => api.linkRequestToTestCase(id, request),
      unlink: (id, request) => api.unlinkRequestFromTestCase(id, request),
      upload: (id, file) => api.saveArtifactToTestCase(id, file),
    },
  };

  /**
   * Writes the draft with the existing bindings, in order. A new record:
   * create (with its requests and test case), save the fields, upload the
   * artifacts. A record: save the fields, link and unlink each changed
   * request, upload and delete each changed artifact. Resolves to
   * { ok: true, kind, id, created } and closes the session; { ok: false,
   * reason: "title" } with an empty title, making no calls; or { ok: false,
   * error } when a call fails, keeping the session with what is still
   * unsaved, so Save again carries on from there.
   */
  async function save() {
    const session = get(store).session;
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
      patchSession({ original, draft });
    };
    patchSession({ saving: true, error: null, confirming: false });
    try {
      if (!original.ID) {
        const created = await calls.create(draft);
        const placed = { ID: created.ID, CreatedAt: created.CreatedAt };
        advance({ ...placed, Requests: [...draft.Requests], TestCaseID: draft.TestCaseID }, placed);
      }
      if (FIELDS[kind].some(([key]) => !same(original[key], draft[key]))) {
        await calls.save({ ...draft, Requests: original.Requests, Artifacts: undefined });
        advance(Object.fromEntries(FIELDS[kind].map(([key]) => [key, draft[key]])));
      }
      for (const request of missingFrom(draft.Requests, original.Requests)) {
        await calls.link(original.ID, request);
        advance({ Requests: [...original.Requests, request] });
      }
      for (const request of missingFrom(original.Requests, draft.Requests)) {
        await calls.unlink(original.ID, request);
        advance({ Requests: original.Requests.filter((r) => r !== request) });
      }
      for (const staged of draft.Artifacts.filter((a) => a.File)) {
        const uploaded = await calls.upload(original.ID, staged.File);
        advance(
          { Artifacts: [...original.Artifacts, uploaded] },
          { Artifacts: draft.Artifacts.map((a) => (a.ID === staged.ID ? uploaded : a)) },
        );
      }
      for (const id of missingFrom(artifactIds(original), artifactIds(draft))) {
        await api.deleteArtifact(id);
        advance({ Artifacts: original.Artifacts.filter((a) => a.ID !== id) });
      }
    } catch (error) {
      patchSession({ saving: false, error });
      return { ok: false, error };
    }
    keep(kind, original);
    setSession(null);
    return { ok: true, kind, id: original.ID, created: session.isNew };
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
