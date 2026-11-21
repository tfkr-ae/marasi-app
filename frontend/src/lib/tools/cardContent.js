// What a card shows, as the app's own classes: CardView.svelte draws it on
// screen, and cardImage.js draws it light for a Drawing's Artifact. Plain
// functions, so they load under node.
//
// cardContent(source, item, { palette, light, findingCount }) →
//   { label, deleted, accent: { classes } | { color },
//     chips: [{ text, classes?, color?, mono?, bold?, plain? }],
//     title: { text, mono }, lines: [{ text }], footer }
// `item` is the pair's row or the record, null once its source is deleted.
// `palette` is the highlight palette; `light` the app's mode; a test case's
// `findingCount` is how many findings name it.
import { SEVERITY_BADGE } from "../logbook/severityColors.js";
import { METHOD_CLASS, statusClass, tertiaryVariant } from "../launchpad/format.js";
import { formatSize, protocolText, shortType } from "../ledger/table.js";
import { recordLabel, recordName } from "./recordKinds.js";

/** The neutral chip, as the Ledger and Logbook draw a number or tag. */
export const CHIP = "bg-surface-200 dark:bg-surface-700";

const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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

export function cardContent(source, item, { palette = [], light = true, findingCount = 0 } = {}) {
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
      ? pairContent(item, palette)
      : source.kind === "finding"
        ? findingContent(item)
        : testCaseContent(item, light, findingCount);
  return { label, deleted: false, ...body };
}
