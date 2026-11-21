// A card drawn light as a PNG, for attachments: an attachment's cards are
// always light, whatever mode the app is in (spec: Putting work back). It
// draws cardContent's model, the one CardView draws on screen, with the
// colours of the same classes read in light mode from a hidden probe, so a
// card's Critical is the Logbook's Critical.
import { get } from "svelte/store";
import { logbookStore } from "../../stores/logbookStore.js";
import { highlightPalette } from "../../stores/highlightsStore.js";
import { cardContent } from "./cardContent.js";
import { pairRows } from "./toolItems.js";

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SCALE = 2;

// The colours `classes` give in light mode: `dark:` classes are dropped,
// and a class that sets no text colour inherits the light card's, not the
// page's (which is light text in dark mode).
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
    probeParent.className = "text-surface-900";
    probeParent.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
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
const escape = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// The card's item now, as CardView finds it.
function itemOf(element) {
  const { source, last } = element.customData;
  const same = (a, b) => String(a) === String(b);
  if (source.kind === "pair") {
    const row = get(pairRows)[String(source.id)];
    return { item: row === undefined ? (last ?? null) : row, findingCount: 0 };
  }
  const state = get(logbookStore);
  const list = source.kind === "finding" ? state.findings : state.testCases;
  return {
    item: list.find((r) => same(r.ID, source.id)) ?? null,
    findingCount: source.kind === "testCase" ? state.findings.filter((f) => same(f.TestCaseID, source.id)).length : 0,
  };
}

/** A PNG data URL of card `element`, light, at its size on screen. */
export async function cardImage(element) {
  const { item, findingCount } = itemOf(element);
  const content = cardContent(element.customData.source, item, {
    palette: get(highlightPalette),
    light: true,
    findingCount,
  });
  const W = element.width;
  const H = element.height;
  // Text size scales the root font; the card on screen scales with it.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
  const px = (n) => n * rem;
  const surface = lightColours("bg-surface-50 text-surface-900");
  const border = lightColours("bg-surface-300").bg;
  const muted = lightColours("text-surface-600").fg;
  const left = px(16);
  const inner = W - left - px(12);
  const parts = [];
  let y = px(10);

  parts.push(
    `<text x="${left}" y="${y + px(8)}" font-family="${SANS}" font-size="${px(10)}" font-weight="700" letter-spacing="1" fill="${muted}">${escape(content.label.toUpperCase())}</text>`,
  );
  y += px(16);

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
    y += titleSize * 1.3;
    parts.push(
      `<text x="${left}" y="${y - titleSize * 0.3}" font-family="${content.title.mono ? MONO : SANS}" font-size="${titleSize}" font-weight="600" fill="${content.deleted ? muted : surface.fg}">${escape(line)}</text>`,
    );
  }
  for (const entry of content.lines) {
    for (const line of wrap(entry.text, `400 ${px(12)}px ${SANS}`, inner, 2)) {
      y += px(16);
      parts.push(`<text x="${left}" y="${y - px(4)}" font-family="${SANS}" font-size="${px(12)}" fill="${muted}">${escape(line)}</text>`);
    }
  }
  if (content.footer) {
    y += px(8);
    parts.push(`<line x1="${left}" x2="${W - px(12)}" y1="${y}" y2="${y}" stroke="${border}" stroke-width="1"/>`);
    y += px(16);
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
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(W * SCALE);
  canvas.height = Math.ceil(H * SCALE);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}
