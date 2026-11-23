// What a card shows, as the app's own classes: CardView.svelte draws it on
// screen, and cardImage.js draws it light for a Drawing's Artifact. Plain
// functions, so they load under node.
//
// cardContent(source, item, { palette, light, findingCount, view, raw }) →
//   { label, deleted, accent: { classes } | { color },
//     chips: [{ text, classes?, color?, mono?, bold?, plain? }],
//     title: { text, mono }, lines: [{ text }], footer }
// and for a pair that isn't deleted, also
//   { part, partName, parts, expanded, firstLines: [{ part, text }], hasResponse }
// and once expanded with its raw messages read, `details`: per part
//   { part, title, lines: [{ text, kind: "start" | "header" | "gap" | "body"
//     | "more", name? }] }, cut at DETAIL_LINES with a "+N more lines" line,
// or { part, title, lines: [], empty } for a response not there yet.
// `item` is the pair's row or the record, null once its source is deleted.
// `palette` is the highlight palette; `light` the app's mode; a test case's
// `findingCount` is how many findings name it. A pair card's `view` is
// cards.js cardView's ({ part, expanded }); `raw` is its pair's raw
// { Request, Response } once read (pairRawStore.js), else undefined: until
// then the card shows no first lines but "No response yet".
import { SEVERITY_BADGE } from "../logbook/severityColors.js";
import { METHOD_CLASS, statusClass, tertiaryVariant } from "../launchpad/format.js";
import { formatSize, protocolText, shortType } from "../ledger/table.js";
import { recordLabel, recordName } from "./recordKinds.js";
import { DEFAULT_VIEW } from "./cards.js";
import { PART_NAMES, hasResponse as rowHasResponse, headerName, pairText, splitMessage } from "../pairMessage.js";

/** The neutral chip, as the Ledger and Logbook draw a number or tag. */
export const CHIP = "bg-surface-200 dark:bg-surface-700";

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** How many lines an expanded card shows of each part before "+N more lines". */
export const DETAIL_LINES = 14;

// A message's start line, from its raw text as the Ledger shows it.
const startLine = (raw) => pairText(raw).split("\n", 1)[0];

// A message's lines as an expanded card shows them: its start line, its
// header field lines (HTTP/2's pseudo-headers too, named with their colon),
// a gap, then its body, cut at DETAIL_LINES.
function messageLines(raw) {
  const { head, body: rest } = splitMessage(pairText(raw));
  const body = rest.replace(/\n+$/, "");
  const [start, ...fields] = head.split("\n");
  const lines = [
    { text: start, kind: "start" },
    ...fields.map((line) => ({ text: line, kind: "header", name: headerName(line) })),
    ...(body ? [{ text: "", kind: "gap" }, ...body.split("\n").map((line) => ({ text: line, kind: "body" }))] : []),
  ];
  if (lines.length <= DETAIL_LINES) return lines;
  return [...lines.slice(0, DETAIL_LINES), { text: `+${lines.length - DETAIL_LINES} more lines`, kind: "more" }];
}

/**
 * A detail line's coloured runs, as CardView and the Artifact's image draw
 * them: [{ text, classes }] covering the whole line, spaces included. A
 * start line shows a request's method and a response's status in their
 * Ledger colours, and a header line its name in the primary colour.
 */
export function lineRuns(line, part) {
  if (line.kind === "start") return startRuns(line.text, part);
  if (line.kind === "header" && line.name) {
    return [
      { text: `${line.name}:`, classes: "text-primary-700 dark:text-primary-400" },
      { text: line.text.slice(line.name.length + 1), classes: "opacity-75" },
    ];
  }
  return [{ text: line.text, classes: "" }];
}

function startRuns(text, part) {
  const words = text.split(" ");
  const runs =
    part === "response"
      ? [
          { text: words[0], classes: "opacity-60" },
          { text: words.slice(1).join(" "), classes: statusClass(Number(words[1])) },
        ]
      : [
          { text: words[0], classes: METHOD_CLASS[words[0]] ?? "" },
          { text: words.slice(1, -1).join(" "), classes: "" },
          { text: words.length > 1 ? words.at(-1) : "", classes: "opacity-50" },
        ];
  const out = [];
  for (const run of runs.filter((r) => r.text)) {
    if (out.length) out.push({ text: " ", classes: "" });
    out.push(run);
  }
  return out;
}

// The parts a pair card holds, and the first line of each, request first;
// expanded, each part's lines in its labelled box.
function pairParts(pair, view, raw) {
  const part = PART_NAMES[view?.part] ? view.part : DEFAULT_VIEW.part;
  const expanded = Boolean(view?.expanded);
  const parts = part === "both" ? ["request", "response"] : [part];
  const hasResponse = rowHasResponse(pair) || Boolean(raw?.Response);
  const message = (p) => (p === "request" ? raw.Request : raw.Response);
  const firstLines = parts.flatMap((p) => {
    if (p === "response" && !hasResponse) return [{ part: p, text: "No response yet" }];
    if (!raw) return [];
    return [{ part: p, text: startLine(message(p)) }];
  });
  const details =
    expanded && raw
      ? parts.map((p) =>
          message(p)
            ? { part: p, title: PART_NAMES[p], lines: messageLines(message(p)) }
            : { part: p, title: PART_NAMES[p], lines: [], empty: "No response yet" },
        )
      : undefined;
  return { part, partName: PART_NAMES[part], parts, expanded, firstLines, hasResponse, ...(details ? { details } : {}) };
}

function pairContent(pair, palette) {
  const code = Number(pair.StatusCode);
  const highlight = pair.Highlight ? palette?.find?.((h) => h.number === pair.Highlight) : null;
  const chips = [
    { text: `#${pair.Number}`, classes: `${CHIP} opacity-80`, mono: true },
    { text: pair.Method, classes: METHOD_CLASS[pair.Method] ?? "", mono: true, bold: true, plain: true },
    { text: code > 0 ? String(code) : "pending", classes: `${CHIP} ${statusClass(code)}`, mono: true, bold: true },
  ];
  if (highlight) chips.push({ text: highlight.label, color: highlight.color });
  return {
    accent: highlight ? { color: highlight.color } : { classes: statusAccent(code) },
    chips,
    title: { text: pair.Path ?? "", mono: true },
    lines: [{ text: `${pair.Scheme ? `${pair.Scheme}://` : ""}${pair.Host ?? ""}` }],
    footer: [shortType(pair.ContentType), formatSize(pair.Length), protocolText(pair)].filter(Boolean).join(" · "),
  };
}

// The accent bar's colour for a pair with no highlight: statusClass's
// colour, as a background.
function statusAccent(code) {
  if (!(code > 0)) return "bg-surface-400";
  if (code < 300) return "bg-success-500";
  if (code < 400) return "bg-warning-800 dark:bg-warning-500";
  return "bg-error-500";
}

function findingContent(finding) {
  // No severity is the Logbook's soft badge.
  const chips = [{ text: finding.Severity || "No severity", classes: SEVERITY_BADGE[finding.Severity] ?? "variant-soft", bold: true }];
  if (finding.CVSSScore) chips.push({ text: `CVSS ${Number(finding.CVSSScore).toFixed(1)}`, classes: CHIP });
  return {
    accent: { classes: SEVERITY_BADGE[finding.Severity] ?? "bg-surface-400" },
    chips,
    title: { text: recordName("finding", finding), mono: false },
    lines: finding.WriteUp ? [{ text: oneLine(finding.WriteUp) }] : [],
    footer: [count(finding.Requests?.length ?? 0, "pair"), count(finding.Artifacts?.length ?? 0, "artifact")].join(" · "),
  };
}

function testCaseContent(testCase, light, findingCount) {
  const chips = [];
  if (testCase.Category) chips.push({ text: testCase.Category, classes: tertiaryVariant(light), bold: true });
  for (const tag of testCase.Tags ?? []) chips.push({ text: `#${tag}`, classes: CHIP });
  return {
    accent: { classes: "bg-tertiary-500" },
    chips,
    title: { text: recordName("testCase", testCase), mono: false },
    lines: testCase.Description ? [{ text: oneLine(testCase.Description) }] : [],
    footer: [
      count(testCase.Requests?.length ?? 0, "pair"),
      count(findingCount ?? 0, "finding"),
      count(testCase.Artifacts?.length ?? 0, "artifact"),
    ].join(" · "),
  };
}

export function cardContent(source, item, { palette = [], light = true, findingCount = 0, view = DEFAULT_VIEW, raw } = {}) {
  const label = recordLabel(source.kind);
  if (!item) {
    return {
      label,
      deleted: true,
      accent: { classes: "bg-surface-400" },
      chips: [],
      title: { text: "Deleted", mono: false },
      lines: [{ text: "Its source was deleted" }],
      footer: "",
    };
  }
  const body =
    source.kind === "pair"
      ? { ...pairContent(item, palette), ...pairParts(item, view, raw) }
      : source.kind === "finding"
        ? findingContent(item)
        : testCaseContent(item, light, findingCount);
  return { label, deleted: false, ...body };
}
