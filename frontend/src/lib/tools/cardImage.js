// A card drawn light as a PNG, for a Drawing's Artifact: its cards are
// always light, whatever mode the app is in (spec: Putting work back). It
// draws cardContent's model, the one CardView draws on screen, with the
// colours of the same classes read in light mode from a hidden probe, so a
// card's Critical is the Logbook's Critical.
import { get } from "svelte/store";
import { logbookStore } from "../../stores/logbookStore.js";
import { highlightPalette } from "../../stores/highlightsStore.js";
import { cardContent } from "./cardContent.js";
import { pairRows } from "../../stores/pairRowsStore.js";
import { pairRaw } from "../../stores/pairRawStore.js";
import { cardView } from "./cards.js";
import { METHOD_CLASS, statusClass } from "../launchpad/format.js";

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SCALE = 2;

// The colours `classes` give in light mode: `dark:` classes are dropped,
// and a class that sets no text colour inherits the page's light text
// (the theme's base font colour), not its dark-mode text.
const probes = new Map();
let probeParent = null;
function lightColours(classes) {
  const key = String(classes ?? "");
  if (probes.has(key)) return probes.get(key);
  const probe = document.createElement("span");
  probe.className = key
    .split(/\s+/)
    .filter((token) => token && !token.startsWith("dark:"))
    .join(" ");
  if (!probeParent?.isConnected) {
    probeParent = document.createElement("div");
    probeParent.style.cssText = "position:fixed;left:-9999px;top:-9999px;color:rgba(var(--theme-font-color-base));";
    probeParent.setAttribute("aria-hidden", "true");
    document.body.appendChild(probeParent);
  }
  probeParent.appendChild(probe);
  const style = getComputedStyle(probe);
  const colours = { fg: style.color, bg: style.backgroundColor, opacity: Number(style.opacity) };
  probe.remove();
  probes.set(key, colours);
  return colours;
}

const measure = document.createElement("canvas").getContext("2d");
function wrap(text, font, width, maxLines) {
  measure.font = font;
  const words = String(text ?? "").split(/(?<=[\s/?&=-])/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line || measure.measureText(line + word).width <= width) line += word;
    else {
      lines.push(line);
      line = word;
    }
    while (measure.measureText(line).width > width && line.length > 1) {
      let cut = line.length;
      while (cut > 1 && measure.measureText(line.slice(0, cut)).width > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let lastLine = lines[maxLines - 1];
    while (lastLine && measure.measureText(`${lastLine}…`).width > width) lastLine = lastLine.slice(0, -1);
    lines[maxLines - 1] = `${lastLine}…`;
  }
  return lines;
}
const textWidth = (text, font) => {
  measure.font = font;
  return measure.measureText(text).width;
};
const escapeXml = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
// Leading spaces as no-break spaces: an SVG drawn as an image collapses
// them, even with xml:space="preserve".
const escape = (text) => escapeXml(String(text).replace(/^ +/, (spaces) => " ".repeat(spaces.length)));
// A message line keeps every space (a body's indentation, aligned values),
// and its coloured runs sit in separate tspans, so all are no-break.
const escapeKept = (text) => escapeXml(String(text).replace(/ /g, " "));

// A start line's words in their Ledger colours, as CardView's startWords:
// [{ text, classes }] covering the whole line, spaces included.
function startSegments(text, part) {
  const words = text.split(" ");
  const segments =
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
  for (const segment of segments.filter((s) => s.text)) {
    if (out.length) out.push({ text: " ", classes: "" });
    out.push(segment);
  }
  return out;
}

// One wrapped row of a line (`row`, starting at offset `from` in it) as
// tspans coloured by the line's `segments`; a segment with no classes takes
// the card's text colour `fill`.
function tspans(row, from, segments, fill) {
  let at = 0;
  const out = [];
  for (const segment of segments) {
    const start = Math.max(at, from);
    const end = Math.min(at + segment.text.length, from + row.length);
    if (start < end) {
      const colours = segment.classes ? lightColours(segment.classes) : { fg: fill, opacity: 1 };
      const opacity = colours.opacity < 1 ? ` fill-opacity="${colours.opacity}"` : "";
      out.push(`<tspan fill="${colours.fg}"${opacity}>${escapeKept(row.slice(start - from, end - from))}</tspan>`);
    }
    at += segment.text.length;
  }
  return out.join("");
}

// An expanded card's detail boxes, as CardView draws them: per part a
// labelled box of its lines, wrapped at the card's width (a long token
// breaks anywhere), header names in the primary colour, a rule before the
// body and "+N more lines" last. Pushes onto `parts`; returns the new y.
function details(boxes, { parts, y, left, inner, px, text }) {
  const border = lightColours("bg-surface-500/20").bg;
  const band = lightColours("bg-surface-200/60").bg;
  const size = px(11);
  const step = size * 1.375;
  const font = (weight) => `${weight} ${size}px ${MONO}`;
  const width = inner - px(16);
  const x = left + px(8);
  for (const box of boxes) {
    const top = y + px(6);
    const rows = [];
    // The title band is 28px on screen (text-3xs's line, py-0.5, its border).
    const bandHeight = px(28);
    let ly = top + bandHeight + px(6);
    if (box.empty) {
      rows.push(`<text x="${x}" y="${ly + size * 0.95}" font-family="${SANS}" font-size="${size}" font-style="italic" fill="${text}" fill-opacity="0.6">${escape(box.empty)}</text>`);
      ly += step;
    }
    for (const line of box.lines) {
      if (line.kind === "gap") {
        ly += px(6);
        rows.push(`<line x1="${x}" x2="${x + width}" y1="${ly}" y2="${ly}" stroke="${border}" stroke-width="1"/>`);
        ly += px(7);
        continue;
      }
      if (line.kind === "more") {
        ly += px(4);
        rows.push(`<text x="${x}" y="${ly + px(10)}" font-family="${SANS}" font-size="${px(10)}" font-style="italic" fill="${text}" fill-opacity="0.5">${escape(line.text)}</text>`);
        ly += px(14);
        continue;
      }
      const weight = line.kind === "start" ? 600 : 400;
      const segments =
        line.kind === "start"
          ? startSegments(line.text, box.part)
          : line.kind === "header" && line.name
            ? [
                { text: `${line.name}:`, classes: "text-primary-700" },
                { text: line.text.slice(line.name.length + 1), classes: "opacity-75" },
              ]
            : [{ text: line.text, classes: "" }];
      let from = 0;
      for (const row of line.text ? wrap(line.text, font(weight), width, Infinity) : [""]) {
        rows.push(`<text x="${x}" y="${ly + size * 0.95}" font-family="${MONO}" font-size="${size}" font-weight="${weight}">${tspans(row, from, segments, text)}</text>`);
        from += row.length;
        ly += step;
      }
    }
    const bottom = ly + px(6);
    parts.push(`<rect x="${left}" y="${top}" width="${inner}" height="${bandHeight}" fill="${band}"/>`);
    parts.push(
      `<text x="${x}" y="${top + bandHeight / 2 + px(3.5)}" font-family="${SANS}" font-size="${px(10)}" font-weight="700" letter-spacing="1" fill="${text}" fill-opacity="0.7">${escape(box.title.toUpperCase())}</text>`,
    );
    parts.push(...rows);
    parts.push(`<rect x="${left + 0.5}" y="${top + 0.5}" width="${inner - 1}" height="${bottom - top - 1}" fill="none" stroke="${border}"/>`);
    y = bottom;
  }
  return y;
}

// The card's item now, as CardView finds it.
function itemOf(element) {
  const { source, last } = element.customData;
  const same = (a, b) => String(a) === String(b);
  if (source.kind === "pair") {
    const row = get(pairRows)[String(source.id)];
    const raw = get(pairRaw)[String(source.id)] ?? undefined;
    return { item: row === undefined ? (last ?? null) : row, findingCount: 0, raw };
  }
  const state = get(logbookStore);
  const list = source.kind === "finding" ? state.findings : state.testCases;
  return {
    item: list.find((r) => same(r.ID, source.id)) ?? null,
    findingCount: source.kind === "testCase" ? state.findings.filter((f) => same(f.TestCaseID, source.id)).length : 0,
  };
}

/** The SVG text of card `element`, light, at its size on screen. */
export function cardSvg(element) {
  const { item, findingCount, raw } = itemOf(element);
  const content = cardContent(element.customData.source, item, {
    palette: get(highlightPalette),
    light: true,
    findingCount,
    view: cardView(element),
    raw,
  });
  const W = element.width;
  const H = element.height;
  // Text size scales the root font; the card on screen scales with it.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
  const px = (n) => n * rem;
  const surface = lightColours("bg-surface-50");
  const border = lightColours("bg-surface-300").bg;
  const muted = lightColours("text-surface-600").fg;
  const left = px(16);
  const inner = W - left - px(12);
  const parts = [];
  // On screen the switch shows a pair card's part; the image names it, in
  // the header row the switch makes as tall as on screen.
  const label = content.partName ? `${content.label} · ${content.partName}` : content.label;
  let y = content.parts ? px(11) : px(10);
  const header = content.parts ? px(28) : px(16);
  parts.push(
    `<text x="${left}" y="${y + header / 2 + px(3.5)}" font-family="${SANS}" font-size="${px(10)}" font-weight="700" letter-spacing="1" fill="${muted}">${escape(label.toUpperCase())}</text>`,
  );
  y += header;

  if (content.chips.length) {
    let x = left;
    y += px(6);
    for (const chip of content.chips) {
      const size = px(12);
      const font = `${chip.bold ? 700 : 400} ${size}px ${chip.mono ? MONO : SANS}`;
      const pad = chip.plain ? 0 : px(6);
      const w = textWidth(chip.text, font) + pad * 2;
      if (x + w > W - px(12)) break;
      const colours = chip.color ? { fg: "#ffffff", bg: chip.color } : lightColours(chip.classes);
      if (!chip.plain) parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${px(20)}" fill="${colours.bg}"/>`);
      parts.push(
        `<text x="${x + pad}" y="${y + px(14)}" font-family="${chip.mono ? MONO : SANS}" font-size="${size}" font-weight="${chip.bold ? 700 : 400}" fill="${colours.fg}">${escape(chip.text)}</text>`,
      );
      x += w + px(6);
    }
    y += px(20);
  }

  const titleSize = content.title.mono ? px(14) : px(16);
  const titleFont = `600 ${titleSize}px ${content.title.mono ? MONO : SANS}`;
  y += px(8);
  for (const line of wrap(content.title.text, titleFont, inner, 2)) {
    // text-sm's line is 20px, text-base leading-snug's 22px.
    const lineHeight = content.title.mono ? px(20) : titleSize * 1.375;
    y += lineHeight;
    parts.push(
      `<text x="${left}" y="${y - (lineHeight - titleSize) / 2 - titleSize * 0.2}" font-family="${content.title.mono ? MONO : SANS}" font-size="${titleSize}" font-weight="600" fill="${content.deleted ? muted : surface.fg}">${escape(line)}</text>`,
    );
  }
  for (const entry of content.lines) {
    for (const line of wrap(entry.text, `400 ${px(12)}px ${SANS}`, inner, 2)) {
      y += px(16);
      parts.push(`<text x="${left}" y="${y - px(4)}" font-family="${SANS}" font-size="${px(12)}" fill="${muted}">${escape(line)}</text>`);
    }
  }
  if (content.details) {
    y = details(content.details, { parts, y, left, inner, px, text: surface.fg });
  } else if (content.firstLines?.length) {
    const font = `400 ${px(11)}px ${MONO}`;
    // As on screen: mt-1.5, then 24px lines (a paragraph's) 2px apart.
    y += px(6);
    for (const [i, entry] of content.firstLines.entries()) {
      const [line] = wrap(`${entry.part === "request" ? "→" : "←"} ${entry.text}`, font, inner, 1);
      y += (i ? px(2) : 0) + px(24);
      parts.push(`<text x="${left}" y="${y - px(8)}" font-family="${MONO}" font-size="${px(11)}" fill="${muted}">${escape(line)}</text>`);
    }
  }
  if (content.footer) {
    y += px(8);
    parts.push(`<line x1="${left}" x2="${W - px(12)}" y1="${y}" y2="${y}" stroke="${border}" stroke-width="1"/>`);
    // pt-1.5, then the footer's 24px line.
    y += px(23);
    parts.push(`<text x="${left}" y="${y}" font-family="${SANS}" font-size="${px(11)}" fill="${muted}">${escape(content.footer)}</text>`);
  }

  const accent = content.accent.color ?? lightColours(content.accent.classes).bg;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
<clipPath id="c"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}"/></clipPath>
<g clip-path="url(#c)">
<rect x="0" y="0" width="${W}" height="${H}" fill="${surface.bg}"/>
<rect x="0" y="0" width="4" height="${H}" fill="${accent}"/>
${parts.join("\n")}
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${border}"${content.deleted ? ' stroke-dasharray="5 4"' : ""}/>
</svg>`;
  return svg;
}

/** A PNG data URL of card `element`, light, at its size on screen. */
export async function cardImage(element) {
  const svg = cardSvg(element);
  const W = element.width;
  const H = element.height;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(W * SCALE);
  canvas.height = Math.ceil(H * SCALE);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}
