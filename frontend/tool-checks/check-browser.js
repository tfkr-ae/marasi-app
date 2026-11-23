// The browser checks of scripts/check-tools.sh: the real pinned Excalidraw
// and CyberChef, in the app's own island and frame (tool-harness/), driven
// from headless Chrome with real input. No mocks and no Marasi service.
// Every check is named, so a bump that breaks one says which.
//
//   node frontend/tool-checks/check-browser.js   (after building the harness)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./chrome.js";
import { createReport } from "./report.js";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontend, ".tool-harness");
if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error("No harness build; run: npx vite build --config tool-harness/vite.config.js (in frontend)");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

// The harness build, as the app serves its own files: same origin, no fallback.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const mac = process.platform === "darwin";
const MOD = mac ? "meta" : "ctrl";
const KEYS = {
  k: { key: "k", code: "KeyK", keyCode: 75 },
  l: { key: "l", code: "KeyL", keyCode: 76 },
  slash: { key: "/", code: "Slash", keyCode: 191 },
  space: { key: " ", code: "Space", keyCode: 32 },
  z: { key: "z", code: "KeyZ", keyCode: 90 },
};

const chrome = await launchChrome();
const { page, requests } = chrome;
const report = createReport("tools");

const leftOrigin = (from) =>
  requests.slice(from).filter(({ url }) => /^(https?|wss?):/.test(url) && !url.startsWith(origin));
const offline = (from) => {
  const outside = leftOrigin(from);
  if (outside.length) throw new Error(`requests left the app's origin: ${outside.map((r) => r.url).join(", ")}`);
};
const events = () => page.evaluate("harness.events().map((e) => e.name)");
const waitEvent = (name, message) =>
  page.waitFor(`harness.events().some((e) => e.name === ${JSON.stringify(name)})`, { timeoutMs: 5000, message });
const centre = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

// The rectangle of `selector` inside CyberChef's frame, in page coordinates.
const frameRect = (selector) =>
  page.evaluate(`(() => {
    const frame = document.querySelector("[data-testid=cyberchef-frame]");
    const el = frame.contentDocument.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const f = frame.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: f.x + r.x, y: f.y + r.y, width: r.width, height: r.height };
  })()`);
const clickInFrame = async (selector) => {
  const rect = await frameRect(selector);
  if (!rect || !rect.width) throw new Error(`${selector} isn't shown in CyberChef`);
  const { x, y } = centre(rect);
  await page.click(x, y);
};

await page.goto(`${origin}/index.html?platform=${mac ? "macos" : "windows-linux"}`);
await page.waitFor("window.harnessReady === true", { message: "the harness didn't load" });

// ---- Excalidraw ----------------------------------------------------------

await report.check("excalidraw mounts with no request outside the app, fonts from the app", async () => {
  const from = requests.length;
  await page.evaluate(`harness.excalidraw({ skeletons: [{ type: "text", x: 240, y: 240, text: "Marasi harness", fontFamily: 5 }] })`);
  await page.waitFor(`document.querySelector(".excalidraw canvas")`, { message: "Excalidraw didn't mount" });
  await page.waitFor(`document.fonts.check('20px "Excalifont"')`, { message: "Excalifont didn't load" });
  const fonts = requests.slice(from).filter(({ url }) => /\/excalidraw-assets\/fonts\/.+\.woff2/.test(url));
  if (!fonts.some((r) => r.url.startsWith(origin) && r.status === 200)) {
    throw new Error("no font came from the app's /excalidraw-assets/fonts/");
  }
  offline(from);
  return `${fonts.length} font files from the app`;
});

await report.check("excalidraw follows the theme", async () => {
  const dark = `Boolean(document.querySelector(".excalidraw.theme--dark"))`;
  if (await page.evaluate(dark)) throw new Error("dark while the app is light");
  await page.evaluate("harness.setDark(true)");
  await page.waitFor(dark, { timeoutMs: 3000, message: "didn't turn dark with the app" });
  await page.evaluate("harness.setDark(false)");
  await page.waitFor(`!${dark}`, { timeoutMs: 3000, message: "didn't turn light again" });
});

await report.check("⌘K from the canvas reaches Marasi's dispatcher", async () => {
  const canvas = await page.evaluate(`(() => {
    const r = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  await page.click(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.75);
  await page.waitFor(`Boolean(document.activeElement?.closest?.(".excalidraw"))`, { timeoutMs: 3000, message: "the canvas didn't take focus" });
  await page.evaluate("harness.clearEvents()");
  await page.press(KEYS.k, [MOD]);
  await waitEvent("menu", `the Marasi menu didn't toggle (events: ${await events()})`);
});

await report.check("⌘/ opens Excalidraw's help dialog", async () => {
  await page.evaluate("harness.clearEvents()");
  await page.press(KEYS.slash, [MOD]);
  await page.waitFor(`document.querySelector(".excalidraw .HelpDialog")`, { timeoutMs: 5000, message: "the help dialog didn't open" });
  if (!(await page.evaluate(`harness.events().some((e) => e.name === "excalidraw.shortcuts")`))) {
    throw new Error("the dialog opened without Excalidraw Shortcuts");
  }
});

// A finding as the Logbook store holds it, delivered as its service events
// would. Its card is the app's own (CardView through cardEmbed.js).
const FINDING = { ID: 7, Title: "SQL injection in /login", Severity: "High", WriteUp: "", Requests: [], Artifacts: [] };
const cardEl = `document.querySelector('[data-testid="card"][data-kind="finding"]')`;
const cardElement = (id) => `harness.cardScene().find((e) => e.id === ${JSON.stringify(id)})`;
let cardId = null;

// An arrow drawn from empty canvas onto card `id` (`el`, on screen at
// `rect`), as a researcher draws it: the card rings while it would bind,
// and the arrow binds on release.
async function drawArrowOnto(el, id, rect) {
  await page.evaluate(`document.querySelector('[data-testid="toolbar-arrow"]').click()`);
  const start = { x: rect.x - 260, y: rect.y + rect.height / 2 };
  const end = { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.6 };
  await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  await page.mouse("mousePressed", start.x, start.y);
  for (let i = 1; i <= 12; i++) {
    const x = start.x + ((end.x - start.x) * i) / 12;
    const y = start.y + ((end.y - start.y) * i) / 12;
    await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  }
  const ringed = await page
    .waitFor(`${el}?.hasAttribute("data-suggested")`, { timeoutMs: 3000 })
    .catch(() => false);
  await page.mouse("mouseReleased", end.x, end.y);
  if (!ringed) throw new Error("the card showed no ring while the arrow would bind");
  await page.waitFor(
    `(() => { const arrow = harness.cardScene().find((e) => e.type === "arrow"); return arrow?.endBinding?.elementId === ${JSON.stringify(id)}; })()`,
    { timeoutMs: 3000, message: "the arrow drawn onto the card isn't bound to it" },
  );
  await page.waitFor(`!${el}?.hasAttribute("data-suggested")`, { timeoutMs: 3000, message: "the ring stayed after the arrow bound" });
}

// Waits for card `id`'s element height to settle; resolves to it.
async function settledHeight(id) {
  let height = 0;
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(`${cardElement(id)}.height`);
    if (Math.abs(now - height) < 1 && i > 2) break;
    height = now;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return height;
}

await report.check("card embeddable renders, accepts an arrow binding, resizes when its content changes", async () => {
  await page.evaluate(`harness.cards({ findings: [${JSON.stringify(FINDING)}] })`);
  cardId = await page.evaluate(`harness.addCard({ kind: "finding", id: 7 }, { x: 640, y: 260 })`);
  await page.waitFor(`${cardEl}?.innerText.includes(${JSON.stringify(FINDING.Title)})`, { message: "the card doesn't show its finding" });

  // It fits its content (outside the undo history) and the embeddable
  // follows: wait for the element's height to settle.
  const height = await settledHeight(cardId);
  const rect = await page.evaluate(`(() => { const r = ${cardEl}.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);

  await drawArrowOnto(cardEl, cardId, rect);

  // Its finding gains a write-up elsewhere: the card grows to fit it.
  await page.evaluate(`harness.changeFinding(${JSON.stringify({ ...FINDING, WriteUp: "The login form passes its username straight into the SQL query. ".repeat(4) })})`);
  await page.waitFor(`${cardEl}?.innerText.includes("The login form passes")`, { timeoutMs: 3000, message: "the card didn't follow its finding" });
  await page.waitFor(`${cardElement(cardId)}.height > ${height + 5}`, { timeoutMs: 3000, message: `the card element stayed ${height}px high` });
  await page.waitFor(
    `Math.abs(${cardEl}.getBoundingClientRect().height - ${cardElement(cardId)}.height * harness.cardZoom()) < 3`,
    { timeoutMs: 3000, message: "the card on screen didn't follow its element's new height" },
  );
  return `${Math.round(height)}px → ${Math.round(await page.evaluate(`${cardElement(cardId)}.height`))}px`;
});

// The arrow above was let go over the card's middle. Excalidraw keeps such a
// tip where it was let go, under the opaque card, so the app moves a bound
// end to the card's edge: its head shows. It stays there when the card
// moves, and the move to the edge is no undo step of its own.
const arrowOnCard = `(() => {
  const scene = harness.cardScene();
  const arrow = scene.find((e) => e.type === "arrow" && !e.isDeleted);
  const card = scene.find((e) => e.id === ${JSON.stringify("CARD")});
  if (!arrow || !card) return null;
  const at = (i) => [arrow.x + arrow.points[i][0], arrow.y + arrow.points[i][1]];
  const tip = at(arrow.points.length - 1);
  const back = at(arrow.points.length - 2);
  const length = Math.hypot(tip[0] - back[0], tip[1] - back[1]);
  // The head: the last 30 scene px of the shaft, behind the tip.
  const head = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const k = Math.min(1, (30 * f) / length);
    return [tip[0] + (back[0] - tip[0]) * k, tip[1] + (back[1] - tip[1]) * k];
  });
  const inBox = ([x, y]) => x > card.x && x < card.x + card.width && y > card.y && y < card.y + card.height;
  const out = (p) => Math.max(card.x - p[0], p[0] - card.x - card.width, card.y - p[1], p[1] - card.y - card.height);
  return { bound: arrow.endBinding?.elementId === card.id, headInside: head.some(inBox), edge: out(tip), tip, card: [card.x, card.y, card.width, card.height] };
})()`;
const onEdge = (state) => state && state.bound && !state.headInside && state.edge > 0 && state.edge < 8;

await report.check("an arrow bound inside a card ends on its edge, its head outside, after a move too", async () => {
  if (!cardId) throw new Error("no card (the card check failed)");
  const probe = arrowOnCard.replace('"CARD"', JSON.stringify(cardId));
  await page.waitFor(`(${onEdge})(${probe})`, { timeoutMs: 3000, message: `the arrow's end isn't on the card's edge: ${JSON.stringify(await page.evaluate(probe))}` });
  // On screen, the tip isn't under the card.
  const covered = await page.evaluate(`(() => {
    const { tip } = ${probe};
    const { scrollX, scrollY, zoom } = harness.cardAppState();
    const canvas = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect();
    const x = canvas.x + (tip[0] + scrollX) * zoom, y = canvas.y + (tip[1] + scrollY) * zoom;
    return Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="card"]'));
  })()`);
  if (covered) throw new Error("the card covers the arrow's tip on screen");

  // The card moves (as a content fit does: no bound-arrow update from Excalidraw).
  const before = await page.evaluate(probe);
  await page.evaluate(`harness.moveCard(${JSON.stringify(cardId)}, 60, -40)`);
  const moved = await page
    .waitFor(`(() => { const s = ${probe}; return s.card[0] === ${before.card[0] + 60} && (${onEdge})(s) && s; })()`, { timeoutMs: 3000 })
    .catch(async () => {
      throw new Error(`after the card moved, the arrow's end isn't on its edge: ${JSON.stringify(await page.evaluate(probe))}`);
    });
  if (Math.abs(moved.tip[0] - before.tip[0]) < 30) throw new Error(`the arrow's end didn't follow the card: ${JSON.stringify({ before, moved })}`);

  // One undo takes the arrow away: the move to the edge was no step of its own.
  await page.evaluate(`document.querySelector(".excalidraw-container").focus()`);
  await page.press(KEYS.z, [MOD]);
  await page.waitFor(`!harness.cardScene().some((e) => e.type === "arrow")`, { timeoutMs: 3000, message: "one undo didn't take the arrow away" });
  await page.press(KEYS.z, [MOD, "shift"]);
  await page.waitFor(`(${onEdge})(${probe})`, { timeoutMs: 3000, message: `after redo, the arrow's end isn't on the card's edge: ${JSON.stringify(await page.evaluate(probe))}` });
  return `tip ${moved.edge.toFixed(1)}px outside the card after the move`;
});

// The Ledger and Logbook draw a GET or a title in the page's text colour,
// so a card's text is the page's, not a surface shade, in both modes.
await report.check("a card's text is the page's colour, light and dark", async () => {
  if (!cardId) throw new Error("no card (the card check failed)");
  const colours = `(() => ({ page: getComputedStyle(document.body).color, card: getComputedStyle(${cardEl}.querySelector('[data-testid="card-title"]')).color }))()`;
  const seen = [];
  for (const dark of [false, true]) {
    await page.evaluate(`harness.setDark(${dark})`);
    await page.waitFor(`document.documentElement.classList.contains("dark") === ${dark}`, { timeoutMs: 3000 });
    const { page: text, card } = await page.evaluate(colours);
    if (card !== text) throw new Error(`${dark ? "dark" : "light"}: the card's text is ${card}, the page's ${text}`);
    seen.push(card);
  }
  await page.evaluate("harness.setDark(false)");
  return seen.join(" / ");
});

await report.check("SVG export carries the scene and its light card images", async () => {
  if (!cardId) throw new Error("no card (the card check failed)");
  // The app in dark mode: the card on screen is dark.
  await page.evaluate("harness.setDark(true)");
  await page.waitFor(
    `(() => { const [r, g, b] = getComputedStyle(${cardEl}).backgroundColor.match(/\\d+/g).map(Number); return r + g + b < 300; })()`,
    { timeoutMs: 3000, message: "the card on screen didn't turn dark with the app" },
  );
  const out = await page.evaluate("harness.attachmentSvg()");
  await page.evaluate("harness.setDark(false)");
  if (!out.svg.includes("payload-type:application/vnd.excalidraw+json")) throw new Error("the SVG has no embedded scene");
  if (/invert\(/.test(out.svg)) throw new Error("the SVG is exported in dark mode");
  const types = out.elements.map((e) => e.type);
  const images = types.filter((t) => t === "image").length;
  if (!types.includes("arrow") || images !== 1 || types.includes("embeddable")) {
    throw new Error(`the scene loaded back holds ${types.join(", ")}; want the arrow and the card as one image`);
  }
  if (types.lastIndexOf("arrow") > types.indexOf("image")) throw new Error("the card image isn't drawn after the arrow");
  // The scene embedded in the file still names the card's source.
  const image = out.elements.find((e) => e.type === "image");
  if (image.link !== "marasi://finding/7") throw new Error(`the card image's link is ${JSON.stringify(image.link)}`);
  if (JSON.stringify(image.customData?.source) !== JSON.stringify({ kind: "finding", id: 7 })) {
    throw new Error(`the card image's source is ${JSON.stringify(image.customData)}`);
  }
  // The arrow ends on the card's edge in the file too, so its head shows.
  const arrow = out.elements.find((e) => e.type === "arrow");
  const [dx, dy] = arrow.points[arrow.points.length - 1];
  const tip = [arrow.x + dx, arrow.y + dy];
  if (tip[0] > image.x && tip[0] < image.x + image.width && tip[1] > image.y && tip[1] < image.y + image.height) {
    throw new Error(`the arrow's tip ${JSON.stringify(tip)} is under the card image`);
  }
  const share = Object.values(out.lightShare)[0];
  if (!(share > 0.5)) throw new Error(`the card image is dark (${Math.round(share * 100)}% light pixels)`);
  return `${out.name}, card image ${Math.round(share * 100)}% light`;
});

// A pair card's Details ▾ expands it to its raw messages: it grows, the
// card under it moves down by as much, and an arrow bound to it stays on
// its edge; Hide details ▴ shrinks it and moves nothing; undo takes it back.
const PAIR_ROW = { ID: "p41", Number: 41, Method: "POST", StatusCode: 200, Scheme: "https", Host: "api.shop.example", Path: "/v2/auth/login" };
const PAIR_RAW = {
  Request: `POST /v2/auth/login HTTP/1.1\nHost: api.shop.example\nContent-Type: application/json\n\n{\n  "username": "alice@example.com",\n  "password": "${"x".repeat(120)}"\n}`,
  Response: "HTTP/1.1 200 OK\nContent-Type: application/json\nSet-Cookie: session=abc\n\n{\"token\":\"abc\"}",
  StatusCode: 200,
};
await report.check("a pair card's Details expands it to its messages, moving the card below and keeping a bound arrow on its edge", async () => {
  await page.evaluate(`harness.cards()`);
  await page.evaluate(`harness.servePairs(${JSON.stringify({ p41: PAIR_RAW })})`);
  const pairEl = `document.querySelector('[data-testid="card"][data-kind="pair"]')`;
  // The card below goes first, so the pair card's first lines arrive with
  // it there: a card growing as its content loads moves nothing clear of it.
  const belowId = await page.evaluate(`harness.addCard({ kind: "finding", id: 7 }, { x: 700, y: 600 })`);
  await settledHeight(belowId);
  const placedY = await page.evaluate(`${cardElement(belowId)}.y`);
  const id = await page.evaluate(`harness.addCard({ kind: "pair", id: "p41" }, { x: 640, y: 160 }, ${JSON.stringify(PAIR_ROW)})`);
  await page.waitFor(`${pairEl}?.querySelector('[data-testid="card-first-lines"]')?.innerText.includes("POST /v2/auth/login")`, {
    timeoutMs: 5000,
    message: "the pair card didn't show its request line",
  });
  const height = await settledHeight(id);
  const loadedY = await page.evaluate(`${cardElement(belowId)}.y`);
  if (loadedY !== placedY) throw new Error(`the card below moved ${placedY} → ${loadedY} as the pair card's first lines loaded`);
  const width = await page.evaluate(`${cardElement(id)}.width`);
  const rect = await page.evaluate(`(() => { const r = ${pairEl}.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  await drawArrowOnto(pairEl, id, rect);
  const probe = arrowOnCard.replace('"CARD"', JSON.stringify(id));
  await page.waitFor(`(${onEdge})(${probe})`, { timeoutMs: 3000, message: `the arrow's end isn't on the card's edge: ${JSON.stringify(await page.evaluate(probe))}` });
  const belowY = await page.evaluate(`${cardElement(belowId)}.y`);

  // Details ▾: the request's box, the card taller at the same width.
  await page.evaluate(`${pairEl}.querySelector('[data-testid="card-details"]').click()`);
  await page.waitFor(`${pairEl}.querySelector('[data-testid="card-detail"][data-part="request"]')?.innerText.includes("Content-Type:")`, {
    timeoutMs: 3000,
    message: "the expanded card doesn't show the request's headers",
  });
  await page.waitFor(`${cardElement(id)}.height > ${height + 100}`, { timeoutMs: 3000, message: `the expanded card stayed ${height}px high` });
  const grown = await settledHeight(id);
  if ((await page.evaluate(`${cardElement(id)}.width`)) !== width) throw new Error("expanding changed the card's width");
  const wraps = await page.evaluate(`(() => { const box = ${pairEl}.querySelector('[data-testid="card-detail"]'); return box.scrollWidth <= box.clientWidth + 1; })()`);
  if (!wraps) throw new Error("a long line runs past the card's width");
  const movedBy = (await page.evaluate(`${cardElement(belowId)}.y`)) - belowY;
  if (Math.abs(movedBy - (grown - height)) > 2) throw new Error(`the card below moved ${movedBy}px for a ${grown - height}px growth`);
  await page.waitFor(`(${onEdge})(${probe})`, { timeoutMs: 3000, message: `after expanding, the arrow's end isn't on the card's edge: ${JSON.stringify(await page.evaluate(probe))}` });

  // Hide details ▴: it shrinks back; the card below stays.
  await page.evaluate(`${pairEl}.querySelector('[data-testid="card-details"]').click()`);
  await page.waitFor(`${cardElement(id)}.height < ${grown - 100}`, { timeoutMs: 3000, message: "the collapsed card didn't shrink" });
  await settledHeight(id);
  const after = await page.evaluate(`${cardElement(belowId)}.y`);
  if (after !== belowY + movedBy) throw new Error(`the card below moved on a shrink: ${belowY + movedBy} → ${after}`);
  await page.waitFor(`(${onEdge})(${probe})`, { timeoutMs: 3000, message: `after collapsing, the arrow's end isn't on the card's edge: ${JSON.stringify(await page.evaluate(probe))}` });

  // Undo takes the collapse back: the card is expanded again.
  await page.evaluate(`document.querySelector(".excalidraw-container").focus()`);
  await page.press(KEYS.z, [MOD]);
  await page.waitFor(`${cardElement(id)}.customData?.view?.expanded === true && Boolean(${pairEl}.querySelector('[data-testid="card-detail"]'))`, {
    timeoutMs: 3000,
    message: "undo didn't expand the card again",
  });
  return `${Math.round(height)}px → ${Math.round(grown)}px, the card below moved ${Math.round(movedBy)}px`;
});

// The Artifact draws a pair card as it shows: expanded, its labelled detail
// boxes with a body's indentation kept (as no-break spaces, since an SVG
// drawn as an image collapses leading spaces); collapsed, its first lines.
// Light either way, with the app in dark mode.
await report.check("SVG export carries the scene and its light card images: an expanded pair card draws its details", async () => {
  const pairEl = `document.querySelector('[data-testid="card"][data-kind="pair"]')`;
  const pairImage = (out) => {
    const image = out.elements.find((e) => e.type === "image" && e.link === "marasi://pair/p41");
    if (!image) throw new Error(`no pair card image in ${out.elements.map((e) => e.link ?? e.type).join(", ")}`);
    return { image, share: out.lightShare[image.id], svg: out.cardSvgs["marasi://pair/p41"] ?? "" };
  };
  const expandedId = await page.evaluate(`harness.cardScene().find((e) => e.link === "marasi://pair/p41")?.id`);
  if (!(await page.evaluate(`${cardElement(expandedId)}.customData?.view?.expanded === true`))) throw new Error("the pair card isn't expanded (the Details check failed)");
  await settledHeight(expandedId);
  await page.evaluate("harness.setDark(true)");
  const open = pairImage(await page.evaluate("harness.attachmentSvg()"));
  await page.evaluate("harness.setDark(false)");
  for (const want of ["PAIR · REQUEST", "Content-Type:", "  &quot;username&quot;"]) {
    if (!open.svg.includes(want)) throw new Error(`the expanded card's image lacks ${JSON.stringify(want)}`);
  }
  if (!open.svg.includes("Hide details ▴")) throw new Error("the expanded card's image doesn't draw its Details row");
  if (!(open.share > 0.5)) throw new Error(`the expanded card's image is dark (${Math.round(open.share * 100)}% light pixels)`);

  await page.evaluate(`${pairEl}.querySelector('[data-testid="card-details"]').click()`);
  await page.waitFor(`${cardElement(expandedId)}.customData?.view?.expanded === false`, { timeoutMs: 3000, message: "the card didn't collapse" });
  await settledHeight(expandedId);
  const shut = pairImage(await page.evaluate("harness.attachmentSvg()"));
  if (shut.svg.includes("Content-Type:") || !shut.svg.includes("→ POST /v2/auth/login")) throw new Error("the collapsed card's image doesn't draw its first lines only");
  if (!shut.svg.includes("Details ▾")) throw new Error("the collapsed card's image doesn't draw its Details row");
  if (!(open.image.height > shut.image.height + 100)) throw new Error(`the expanded image is ${open.image.height}px high, the collapsed ${shut.image.height}px`);
  if (!(shut.share > 0.5)) throw new Error(`the collapsed card's image is dark (${Math.round(shut.share * 100)}% light pixels)`);
  return `expanded ${Math.round(open.image.height)}px (${Math.round(open.share * 100)}% light), collapsed ${Math.round(shut.image.height)}px`;
});

// ---- CyberChef -----------------------------------------------------------

const chefDoc = `document.querySelector("[data-testid=cyberchef-frame]").contentDocument`;
const chefWin = `document.querySelector("[data-testid=cyberchef-frame]").contentWindow`;
// The app origin's localStorage, as entries, before CyberChef first loads.
const appStorage = `JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))`;
const storageBefore = await page.evaluate(appStorage);

await report.check("cyberchef loads with no request outside the app, and keeps the recipe it opened on", async () => {
  const from = requests.length;
  const recipe = { id: "seed", operations: [{ op: "To Base64", args: ["A-Za-z0-9+/="] }], inputs: ["seed one", "seed two"] };
  await page.evaluate(`harness.cyberchef(${JSON.stringify(recipe)})`);
  if (!requests.slice(from).some((r) => r.url === `${origin}/tools/cyberchef/assets/main.js` && r.status === 200)) {
    throw new Error("CyberChef's main.js didn't come from the app");
  }
  // CyberChef finishes loading (and reads its URL) after the adapter is ready.
  await page.waitFor(`!${chefDoc}.getElementById("loader-wrapper")`, { timeoutMs: 30000, message: "CyberChef's loading screen stayed" });
  const shown = await page.evaluate(`harness.chef().getInputs().then((inputs) => ({ inputs, ops: harness.chef().getRecipe().map((o) => o.op) }))`);
  if (JSON.stringify(shown) !== JSON.stringify({ inputs: recipe.inputs, ops: ["To Base64"] })) {
    throw new Error(`the recipe it opened on became ${JSON.stringify(shown)}`);
  }
  offline(from);
});

// Each adapter call on a known recipe, naming the call that broke.
await report.check("cyberchef adapter calls work on a known recipe", async () => {
  // Bake on demand only: CyberChef's own Auto Bake box, clicked.
  await clickInFrame("#auto-bake-label");
  const autoBake = `${chefDoc}.getElementById("auto-bake").checked`;
  if (await page.evaluate(autoBake)) throw new Error("Auto Bake didn't turn off");
  const result = await page.evaluate(`(async () => {
    const a = harness.chef();
    const root = () => document.querySelector("[data-testid=cyberchef-frame]").contentDocument.documentElement;
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const step = async (name, fn) => { try { await fn(); } catch (err) { throw new Error(name + ": " + (err?.message ?? err)); } };
    await step("ready", () => a.ready(5000));
    await step("load an empty recipe", async () => {
      await a.load({ operations: [], inputs: [] });
      const inputs = await a.getInputs();
      if (!same(inputs, [""]) || a.getRecipe().length) throw new Error(JSON.stringify({ inputs, recipe: a.getRecipe() }));
    });
    await step("setRecipe/getRecipe", () => {
      a.setRecipe([{ op: "To Base64", args: ["A-Za-z0-9+/="] }]);
      const got = a.getRecipe();
      if (got.length !== 1 || got[0].op !== "To Base64") throw new Error("got " + JSON.stringify(got));
    });
    await step("insertInput into the empty tab", async () => {
      await a.insertInput("hello");
      const got = await a.getInputs();
      if (!same(got, ["hello"])) throw new Error("inputs " + JSON.stringify(got));
    });
    await step("insertInput into a new tab", async () => {
      await a.insertInput("world");
      const got = await a.getInputs();
      if (!same(got, ["hello", "world"])) throw new Error("inputs " + JSON.stringify(got));
    });
    await step("getInputs", async () => {
      const got = await a.getInputs();
      if (!same(got, ["hello", "world"])) throw new Error("inputs " + JSON.stringify(got));
    });
    await step("bake/getOutput", async () => {
      if ((await a.getOutput()) === "d29ybGQ=") throw new Error("baked before bake()");
      const baked = await a.bake();
      if (baked !== "d29ybGQ=") throw new Error("bake resolved to " + JSON.stringify(baked));
      if ((await a.getOutput()) !== "d29ybGQ=") throw new Error("output " + JSON.stringify(await a.getOutput()));
    });
    await step("two bakes at once share one, and CyberChef isn't left baking", async () => {
      a.setRecipe([{ op: "To Hex", args: ["Space", 0] }]);
      const both = await Promise.all([a.bake(), a.bake()]);
      if (!same(both, ["77 6f 72 6c 64", "77 6f 72 6c 64"])) throw new Error("bakes resolved to " + JSON.stringify(both));
      const w = document.querySelector("[data-testid=cyberchef-frame]").contentWindow;
      if (w.app.baking) throw new Error("CyberChef still says it is baking");
      a.setRecipe([{ op: "To Base64", args: ["A-Za-z0-9+/="] }]);
    });
    await step("setTheme", async () => {
      a.setTheme("dark");
      if (root().className !== "dark") throw new Error("class " + root().className);
      a.setTheme("classic");
      if (root().className !== "classic") throw new Error("class " + root().className);
    });
    await step("load a recipe with two inputs", async () => {
      await a.load({ operations: [{ op: "To Hex", args: ["Space", 0] }], inputs: ["ab", "cd"] });
      const inputs = await a.getInputs();
      if (!same(inputs, ["ab", "cd"]) || a.getRecipe()[0]?.op !== "To Hex") throw new Error(JSON.stringify({ inputs, recipe: a.getRecipe() }));
    });
    return "ok";
  })()`);
  if (result !== "ok") throw new Error(String(result));
});

await report.check("⌘K inside CyberChef's frame reaches Marasi's dispatcher", async () => {
  await clickInFrame("#input-text .cm-content, #input-text");
  await page.evaluate("harness.clearEvents()");
  await page.press(KEYS.k, [MOD]);
  await waitEvent("menu", `the Marasi menu didn't toggle (events: ${await events()})`);
});

await report.check("Ctrl+Alt+Space still bakes in CyberChef", async () => {
  await page.evaluate(`harness.chef().load({ operations: [{ op: "To Base64", args: ["A-Za-z0-9+/="] }], inputs: ["bake me"] })`);
  const output = `harness.chef().getOutput()`;
  // getOutput waits for any bake to end, so the key meets a CyberChef at
  // rest: pressed during a bake, CyberChef's own Bake cancels it instead.
  if ((await page.evaluate(output)) === "YmFrZSBtZQ==") throw new Error("baked before the key");
  await clickInFrame("#input-text .cm-content, #input-text");
  await page.press(KEYS.space, ["ctrl", "alt"]);
  await page.waitFor(`${output}.then((text) => text === "YmFrZSBtZQ==")`, { timeoutMs: 30000, message: "Ctrl+Alt+Space didn't bake" });
});

await report.check("Insert bakes with Auto Bake on, in LF, and Attach's output is current", async () => {
  const autoBake = `${chefDoc}.getElementById("auto-bake").checked`;
  await page.evaluate(`harness.chef().load({ operations: [{ op: "To Hex", args: ["None", 0] }], inputs: [""] })`);
  if (!(await page.evaluate(autoBake))) await clickInFrame("#auto-bake-label");
  await page.waitFor(autoBake, { timeoutMs: 3000, message: "Auto Bake didn't turn on" });
  await page.evaluate(`harness.chef().settled()`);
  // A request as the service hands it over, in CRLF.
  await page.evaluate(`harness.insertPair("GET / HTTP/1.1\\r\\nHost: a\\r\\n\\r\\n")`);
  const hex = Buffer.from("GET / HTTP/1.1\nHost: a\n\n").toString("hex");
  const inputs = await page.evaluate(`harness.chef().getInputs()`);
  if (JSON.stringify(inputs) !== JSON.stringify(["GET / HTTP/1.1\nHost: a\n\n"])) throw new Error(`inserted ${JSON.stringify(inputs)}`);
  // Auto Bake runs on its own; nothing here asks for a bake.
  await page.waitFor(`harness.chef().getOutput().then((text) => text === ${JSON.stringify(hex)})`, {
    timeoutMs: 30000,
    message: "the inserted input didn't bake",
  });
  // Auto Bake off: a second insert leaves the output stale, and Attach's
  // currentOutput bakes it before it reads.
  await clickInFrame("#auto-bake-label");
  if (await page.evaluate(autoBake)) throw new Error("Auto Bake didn't turn off");
  await page.evaluate(`harness.insertPair("x")`);
  const out = await page.evaluate(`harness.chef().currentOutput()`);
  if (out !== "78") throw new Error(`currentOutput gave ${JSON.stringify(out)}`);
});

await report.check("replacing an open input tab's text rebakes, with the output current", async () => {
  const autoBake = `${chefDoc}.getElementById("auto-bake").checked`;
  await page.evaluate(`harness.chef().load({ operations: [{ op: "To Hex", args: ["None", 0] }], inputs: ["ab", "cd"] })`);
  if (!(await page.evaluate(autoBake))) await clickInFrame("#auto-bake-label");
  await page.waitFor(autoBake, { timeoutMs: 3000, message: "Auto Bake didn't turn on" });
  await page.evaluate(`harness.chef().settled()`);
  const tabs = await page.evaluate(`harness.chef().getInputTabs()`);
  if (JSON.stringify(tabs.map((t) => t.text)) !== JSON.stringify(["ab", "cd"])) throw new Error(`tabs ${JSON.stringify(tabs)}`);
  const open = await page.evaluate(`harness.chef().openTab()`);
  if (open !== tabs[1].num) throw new Error(`open tab ${open}, tabs ${JSON.stringify(tabs)}`);
  // As the From bar swaps: the open tab's text, by its number.
  await page.evaluate(`harness.chef().replaceInput(${open}, "xy")`);
  const inputs = await page.evaluate(`harness.chef().getInputs()`);
  if (JSON.stringify(inputs) !== JSON.stringify(["ab", "xy"])) throw new Error(`inputs became ${JSON.stringify(inputs)}`);
  // Auto Bake follows it, as it follows an insert.
  await page.waitFor(`harness.chef().getOutput().then((text) => text === "7879")`, { timeoutMs: 30000, message: "the replaced input didn't bake" });
  // Auto Bake off: the output is stale until Attach's currentOutput bakes it.
  await clickInFrame("#auto-bake-label");
  if (await page.evaluate(autoBake)) throw new Error("Auto Bake didn't turn off");
  await page.evaluate(`harness.chef().replaceInput(${open}, "z")`);
  const out = await page.evaluate(`harness.chef().currentOutput()`);
  if (out !== "7a") throw new Error(`currentOutput gave ${JSON.stringify(out)}`);
});

await report.check("CyberChef's Save and Load buttons are intercepted", async () => {
  const shown = (id) => `document.querySelector("[data-testid=cyberchef-frame]").contentDocument.getElementById("${id}")?.classList.contains("show")`;
  await page.evaluate("harness.clearEvents()");
  await clickInFrame("#save");
  await waitEvent("saveRecipe", "Save didn't open Rename");
  await clickInFrame("#load");
  await waitEvent("loadRecipe", "Load didn't open Switch");
  await page.evaluate("harness.clearEvents()");
  await clickInFrame("#input-text .cm-content, #input-text");
  await page.press(KEYS.l, ["ctrl", "alt"]);
  await waitEvent("loadRecipe", "Ctrl+Alt+L didn't open Switch");
  for (const id of ["save-modal", "load-modal"]) {
    if (await page.evaluate(shown(id))) throw new Error(`CyberChef's own ${id} opened`);
  }
});

await report.check("cyberchef writes nothing to the app origin's localStorage (load, theme switch, bake)", async () => {
  // The checks above loaded, baked and set CyberChef's theme; switch the
  // app's theme through the frame too, and bake once more.
  await page.evaluate("harness.setDark(true)");
  await page.evaluate("harness.setDark(false)");
  const baked = await page.evaluate(`(async () => {
    const a = harness.chef();
    await a.load({ operations: [{ op: "To Base64", args: ["A-Za-z0-9+/="] }], inputs: ["stored?"] });
    return a.bake();
  })()`);
  if (baked !== "c3RvcmVkPw==") throw new Error(`baked ${JSON.stringify(baked)}`);
  const frameStorage = await page.evaluate(`(() => {
    const own = ${chefWin}.localStorage;
    return { separate: own !== localStorage, keys: Object.keys(own) };
  })()`);
  if (!frameStorage.separate) throw new Error("CyberChef's frame uses the app's localStorage");
  const after = await page.evaluate(appStorage);
  if (after !== storageBefore) throw new Error(`the app's localStorage changed: ${storageBefore} → ${after}`);
  return `CyberChef kept ${frameStorage.keys.join(", ") || "nothing"} in memory`;
});

await report.check("no request left the app's origin during the run", async () => {
  offline(0);
  return `${requests.length} requests`;
});

await chrome.close();
server.close();
process.exitCode = report.finish();
