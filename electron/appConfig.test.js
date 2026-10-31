import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { createAppConfig } from "./appConfig.js";
import { memoryFS } from "./testing/memoryFS.js";
import { nodeFS } from "./nodeFS.js";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = "/config/Marasi";
const path = `${dir}/marasi_appconfig.yaml`;

const testCasesPath = `${dir}/test_cases.yml`;
const defaultTestCases = "title: WSTG\nversion: '1.0.0'\ntest_cases:\n  - title: Fingerprint\n    category: Info\n";

function setup(text, files = {}) {
  const fs = memoryFS({ ...(text === undefined ? {} : { [path]: text }), ...files });
  const config = createAppConfig({ dir, fs, platform: "darwin", defaultTestCases });
  return { fs, config, saved: () => parse(fs.files.get(path)) };
}

test("a flag write keeps a key v2 doesn't know, and its comment", async () => {
  const { fs, config, saved } = setup(
    "text_size: default\n# kept by v1\nfuture_key:\n  nested: [1, 2]\n",
  );
  await config.setFlag("text_size", "large");
  assert.equal(saved().text_size, "large");
  assert.deepEqual(saved().future_key, { nested: [1, 2] });
  assert.match(fs.files.get(path), /# kept by v1\nfuture_key:/);
});

test("toggling a flag writes a boolean v1 reads, and refuses a key that isn't a switch", async () => {
  const { config, saved } = setup("vim_enabled: true\n");
  const after = await config.toggleFlag("vim_enabled");
  assert.equal(after.VimEnabled, false);
  assert.equal(saved().vim_enabled, false);
  await assert.rejects(config.toggleFlag("text_size"), /text_size/);
  await assert.rejects(config.toggleFlag("keybindings"), /keybindings/);
  await assert.rejects(config.setFlag("keybindings", "x"), /keybindings/);
  assert.equal(saved().keybindings, undefined);
});

test("the preferences read as v1 reports them, with v1's defaults for missing keys", async () => {
  const { config } = setup("vim_enabled: 'false'\ndefault_port: 9090\ntext_size: large\n");
  const { TestCaseProfile, ...preferences } = await config.marasiConfig();
  assert.deepEqual(preferences, {
    ConfigDir: dir,
    DesktopOS: "darwin",
    FirstRun: true,
    VimEnabled: false,
    DefaultAddress: "127.0.0.1",
    DefaultPort: "9090",
    SyntaxMode: "auto",
    WrapMode: "auto",
    TextSize: "large",
  });
});

test("a write that fails leaves the file as it was", async () => {
  const before = "text_size: small\nother: 1\n";
  const { fs, config } = setup(before);
  fs.failWrites = true;
  await assert.rejects(config.setFlag("text_size", "large"), /ENOSPC/);
  assert.equal(fs.files.get(path), before);
  assert.deepEqual([...fs.files.keys()], [path]);
});

test("the written file is private to the user", async () => {
  const { fs, config } = setup("text_size: small\n");
  await config.setFlag("text_size", "large");
  assert.equal(fs.modes.get(path), 0o600);
});

test("loading adds v1's missing keys once and leaves the ones there alone", async () => {
  const { config, saved } = setup("text_size: large\nkeybindings: not a section\nfuture_key: 1\n");
  await config.load();
  const values = saved();
  assert.equal(values.text_size, "large");
  assert.equal(values.keybindings, "not a section");
  assert.equal(values.future_key, 1);
  assert.equal(values.vim_enabled, true);
  assert.equal(values.default_port, "8080");
  assert.equal(values.highlights.length, 8);
  assert.deepEqual(values.highlights[0], { color: "#ef4444" });
  assert.ok(values.ledger_content_type_exclusion.includes("image/png"));
  assert.equal(values.saved_queries, undefined);
});

test("a fresh config dir gets v1's factory keybindings section", async () => {
  const { config, saved } = setup();
  await config.load();
  assert.deepEqual(saved().keybindings, {
    version: 1,
    active_profile: "default",
    profiles: [
      { id: "default", name: "Default", overrides: { macos: [], "windows-linux": [] }, known_actions: [] },
    ],
  });
});

test("the test case profile comes from test_cases.yml, written from the default when missing", async () => {
  const { fs, config } = setup();
  await config.load();
  assert.equal(fs.files.get(testCasesPath), defaultTestCases);
  const own = setup("", { [testCasesPath]: "title: Mine\ntest_cases:\n  - title: A\n    description: B\n    category: C\n" });
  await own.config.load();
  assert.deepEqual((await own.config.marasiConfig()).TestCaseProfile, {
    Title: "Mine",
    Description: "",
    Version: "",
    TestCases: [{ Title: "A", Description: "B", Category: "C" }],
  });
});

const savedSection = `keybindings:
  version: 1
  active_profile: mine
  profiles:
    - id: mine
      name: Mine
      overrides:
        macos:
          - action: global.go-ledger
            keys:
              - meta+l
        windows-linux: []
      known_actions:
        - global.go-ledger
`;

const mine = {
  version: 1,
  activeProfile: "mine",
  profiles: [
    {
      id: "mine",
      name: "Mine",
      overrides: { macos: [{ action: "global.go-ledger", keys: ["meta+l"] }], "windows-linux": [] },
      knownActions: ["global.go-ledger"],
    },
  ],
};

const factory = {
  version: 1,
  activeProfile: "default",
  profiles: [{ id: "default", name: "Default", overrides: { macos: [], "windows-linux": [] }, knownActions: [] }],
};

test("saved keybindings read in the frontend's shape", async () => {
  const { config } = setup(savedSection);
  assert.deepEqual(await config.keybindings(), { config: mine, problem: "" });
});

test("an unusable keybindings section reads as the factory profile with a problem, and stays on disk", async () => {
  for (const [section, problem] of [
    ["keybindings:\n  version: 2\n  future: true\n", /version 2 is not supported/],
    ["keybindings:\n  version: 1\n  active_profile: x\n  profiles: []\n  extra: 1\n", /extra/],
    ["keybindings:\n  version: 1\n  active_profile: gone\n  profiles:\n    - {id: a, name: A, overrides: {}, known_actions: []}\n", /active profile "gone"/],
    ["keybindings:\n  version: 1\n  active_profile: a\n  profiles:\n    - {id: a, name: A, overrides: {macos: [{action: global.open-menu, keys: [escape]}]}, known_actions: []}\n", /reserved/],
    ["keybindings:\n  version: 1\n  active_profile: a\n  profiles:\n    - {id: a, name: A, overrides: {macos: [{action: global.open-menu}]}, known_actions: []}\n", /missing keys/],
  ]) {
    const { config, saved } = setup(section);
    await config.load();
    const state = await config.keybindings();
    assert.deepEqual(state.config, factory);
    assert.match(state.problem, problem);
    assert.deepEqual(saved().keybindings, parse(section).keybindings);
  }
});

test("saving keybindings writes v1's section and nothing else", async () => {
  const { config, saved } = setup("text_size: large\nkeybindings: broken\n");
  const state = await config.saveKeybindings(mine);
  assert.deepEqual(state, { config: mine, problem: "" });
  assert.deepEqual(saved(), { text_size: "large", ...parse(savedSection) });
});

test("keybindings that break the section's rules are refused and the file is unchanged", async () => {
  const { fs, config } = setup(savedSection);
  const twice = { ...mine, profiles: [mine.profiles[0], { ...mine.profiles[0], name: "Other" }] };
  await assert.rejects(config.saveKeybindings(twice), /invalid keybindings: profile id "mine" is used twice/);
  await assert.rejects(config.saveKeybindings({ ...mine, activeProfile: "nope" }), /active profile "nope"/);
  assert.equal(fs.files.get(path), savedSection);
});

test("highlights read v1's 8 entries, with defaults for a bad or missing one", async () => {
  const { config } = setup("highlights:\n  - color: '#AABBCC'\n    label: ' Auth '\n  - color: red\n    label: Kept\n");
  const highlights = await config.highlights();
  assert.equal(highlights.length, 8);
  assert.deepEqual(highlights[0], { color: "#aabbcc", label: "Auth" });
  assert.deepEqual(highlights[1], { color: "#f97316", label: "Kept" });
  assert.deepEqual(highlights[7], { color: "#ec4899", label: "" });
});

test("saving highlights writes them as v1 does and refuses a bad colour", async () => {
  const { fs, config, saved } = setup("highlights: []\n");
  const next = (await config.highlights()).map((h, i) => (i === 2 ? { color: "#123456", label: "IDOR" } : h));
  assert.deepEqual((await config.saveHighlights(next))[2], { color: "#123456", label: "IDOR" });
  assert.deepEqual(saved().highlights[2], { color: "#123456", label: "IDOR" });
  assert.deepEqual(saved().highlights[0], { color: "#ef4444" });
  const before = fs.files.get(path);
  await assert.rejects(config.saveHighlights(next.slice(1)), /wanted 8 highlights, got 7/);
  await assert.rejects(config.saveHighlights(next.map((h, i) => (i ? h : { color: "blue" }))), /highlight 1: "blue"/);
  assert.equal(fs.files.get(path), before);
  assert.deepEqual((await config.resetHighlights())[2], { color: "#eab308", label: "" });
});

test("app saved queries and hidden built-ins round trip in v1's keys", async () => {
  const { config, saved } = setup(
    "saved_queries:\n  - {id: b, name: B, query: 'status = 500', order: 2}\n  - {id: a, name: ' A ', query: x, order: 1}\n  - {id: a, name: Dup, query: y, order: 3}\n  - {id: '', name: Bad, query: z, order: 4}\n",
  );
  assert.deepEqual(await config.appSavedQueries(), {
    queries: [
      { id: "a", name: "A", query: "x", order: 1 },
      { id: "b", name: "B", query: "status = 500", order: 2 },
    ],
    hidden_builtins: [],
  });
  const list = await config.saveAppSavedQueries([{ id: "c", name: "C", query: "q", order: 0 }]);
  assert.deepEqual(list, [{ id: "c", name: "C", query: "q", order: 0 }]);
  assert.deepEqual(saved().saved_queries, list);
  await assert.rejects(config.saveAppSavedQueries([{ id: "c", name: "C", query: "" }]), /has no query/);
  await assert.rejects(
    config.saveAppSavedQueries([{ id: "c", name: "C", query: "q" }, { id: "c", name: "D", query: "q" }]),
    /id c is used twice/,
  );
  assert.deepEqual(await config.setHiddenBuiltinQueries([" x ", "x", "", "y"]), ["x", "y"]);
  assert.deepEqual(saved().hidden_builtin_queries, ["x", "y"]);
});

test("the default content-type exclusion is read and replaced as a list", async () => {
  const { config, saved } = setup();
  await config.load();
  assert.ok((await config.defaultContentTypeExclusion()).includes("font/woff2"));
  await config.setDefaultContentTypeExclusion(["image/*"]);
  assert.deepEqual(saved().ledger_content_type_exclusion, ["image/*"]);
  assert.deepEqual(await config.defaultContentTypeExclusion(), ["image/*"]);
  await config.setDefaultContentTypeExclusion([]);
  assert.deepEqual(saved().ledger_content_type_exclusion, []);
  await assert.rejects(config.setDefaultContentTypeExclusion(["image/*", 3]), /list of content types/);
});

test("on a real disk, a write replaces the file whole and leaves no temp file", async (t) => {
  const real = await mkdtemp(join(tmpdir(), "mv2-config-"));
  t.after(() => rm(real, { recursive: true, force: true }));
  await writeFile(join(real, "marasi_appconfig.yaml"), "text_size: small\nv1_only: kept\n");
  const config = createAppConfig({ dir: real, fs: nodeFS, defaultTestCases });
  await config.load();
  await config.setFlag("text_size", "xlarge");
  const values = parse(await readFile(join(real, "marasi_appconfig.yaml"), "utf8"));
  assert.equal(values.text_size, "xlarge");
  assert.equal(values.v1_only, "kept");
  assert.deepEqual((await readdir(real)).sort(), ["marasi_appconfig.yaml", "test_cases.yml"]);
  assert.equal((await stat(join(real, "marasi_appconfig.yaml"))).mode & 0o777, 0o600);
});
