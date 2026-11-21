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

await report.check("card embeddable renders, accepts an arrow binding, resizes when its content changes", async () => {
  await page.evaluate(`harness.cards({ findings: [${JSON.stringify(FINDING)}] })`);
  cardId = await page.evaluate(`harness.addCard({ kind: "finding", id: 7 }, { x: 640, y: 260 })`);
  await page.waitFor(`${cardEl}?.innerText.includes(${JSON.stringify(FINDING.Title)})`, { message: "the card doesn't show its finding" });

  // It fits its content (outside the undo history) and the embeddable
  // follows: wait for the element's height to settle.
  let height = 0;
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(`${cardElement(cardId)}.height`);
    if (Math.abs(now - height) < 1 && i > 2) break;
    height = now;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const rect = await page.evaluate(`(() => { const r = ${cardEl}.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);

  // An arrow drawn from empty canvas onto the card, as a researcher draws it:
  // the card rings while it would bind, and the arrow binds on release.
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
    .waitFor(`${cardEl}?.hasAttribute("data-suggested")`, { timeoutMs: 3000 })
    .catch(() => false);
  await page.mouse("mouseReleased", end.x, end.y);
  if (!ringed) throw new Error("the card showed no ring while the arrow would bind");
  await page.waitFor(
    `(() => { const arrow = harness.cardScene().find((e) => e.type === "arrow"); return arrow?.endBinding?.elementId === ${JSON.stringify(cardId)}; })()`,
    { timeoutMs: 3000, message: "the arrow drawn onto the card isn't bound to it" },
  );
  await page.waitFor(`!${cardEl}?.hasAttribute("data-suggested")`, { timeoutMs: 3000, message: "the ring stayed after the arrow bound" });

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
  const share = Object.values(out.lightShare)[0];
  if (!(share > 0.5)) throw new Error(`the card image is dark (${Math.round(share * 100)}% light pixels)`);
  return `${out.name}, card image ${Math.round(share * 100)}% light`;
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
    const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };
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
      a.bake();
      if (!(await until(async () => (await a.getOutput()) === "d29ybGQ="))) throw new Error("output " + JSON.stringify(await a.getOutput()));
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
  if ((await page.evaluate(output)) === "YmFrZSBtZQ==") throw new Error("baked before the key");
  await clickInFrame("#input-text .cm-content, #input-text");
  await page.press(KEYS.space, ["ctrl", "alt"]);
  await page.waitFor(`${output}.then((text) => text === "YmFrZSBtZQ==")`, { timeoutMs: 10000, message: "Ctrl+Alt+Space didn't bake" });
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
    // A bake asked for while CyberChef is still settling the load can be
    // dropped, so ask again until the output arrives.
    for (const t = Date.now(); Date.now() - t < 10000; ) {
      a.bake();
      await new Promise((r) => setTimeout(r, 250));
      if ((await a.getOutput()) === "c3RvcmVkPw==") return true;
    }
    return false;
  })()`);
  if (!baked) throw new Error("didn't bake");
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
