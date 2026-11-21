// The kinds of record a tool document goes back to, and what a card can
// show: the one place their names live. A source's `kind` is one of
// "pair", "finding" or "testCase".

/** Findings and test cases: their label, the noun in running text, and their list in the Logbook state. */
export const RECORD_KINDS = {
  finding: { label: "Finding", noun: "finding", list: "findings" },
  testCase: { label: "Test case", noun: "test case", list: "testCases" },
};

const LABELS = { pair: "Pair", finding: RECORD_KINDS.finding.label, testCase: RECORD_KINDS.testCase.label };

export const isRecordKind = (kind) => Object.hasOwn(RECORD_KINDS, kind);

/** "Pair", "Finding" or "Test case". */
export const recordLabel = (kind) => LABELS[kind] ?? kind;

/** A finding's or test case's title, or "Untitled finding" / "Untitled test case". */
export const recordName = (kind, record) => record?.Title || `Untitled ${RECORD_KINDS[kind]?.noun ?? kind}`;

/** The Logbook state's findings or test cases. */
export const recordsOf = (state, kind) => state[RECORD_KINDS[kind].list] ?? [];
