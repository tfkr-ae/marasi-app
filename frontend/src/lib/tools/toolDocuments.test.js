import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createToolDocuments, drawingKind, recipeKind } from "./toolDocuments.js";

const scene = (count) => ({ elements: Array.from({ length: count }, (_, i) => ({ id: `e${i}` })), appState: {} });

function setup() {
  const documents = createToolDocuments({ drawing: drawingKind });
  documents.useProject("/p/one.marasi");
  return { documents, drawings: documents.kind("drawing") };
}

test("a project starts with one empty drawing, open", () => {
  const { drawings } = setup();
  const state = get(drawings);
  assert.deepEqual(state.items.map((d) => d.name), ["Drawing 1"]);
  assert.equal(state.openId, state.items[0].id);
  assert.equal(drawings.current().name, "Drawing 1");
});

test("create opens a new drawing with the next number", () => {
  const { drawings } = setup();
  const made = drawings.create();
  assert.equal(made.name, "Drawing 2");
  assert.equal(get(drawings).openId, made.id);
});

test("open, rename and change act on the drawing named", () => {
  const { drawings } = setup();
  const first = drawings.current();
  const second = drawings.create();
  drawings.open(first.id);
  drawings.rename(second.id, "Login flow");
  drawings.change(second.id, { scene: scene(2), files: { f1: { id: "f1" } } });
  const state = get(drawings);
  assert.equal(state.openId, first.id);
  const changed = state.items.find((d) => d.id === second.id);
  assert.equal(changed.name, "Login flow");
  assert.equal(changed.scene.elements.length, 2);
  assert.deepEqual(Object.keys(changed.files), ["f1"]);
});

test("a blank rename keeps the old name", () => {
  const { drawings } = setup();
  const { id } = drawings.current();
  drawings.rename(id, "   ");
  assert.equal(drawings.current().name, "Drawing 1");
});

test("duplicate copies the scene under a new id and opens it", () => {
  const { drawings } = setup();
  const from = drawings.current();
  drawings.change(from.id, { scene: scene(1), files: {} });
  const copy = drawings.duplicate(from.id);
  assert.notEqual(copy.id, from.id);
  assert.equal(copy.name, "Drawing 1 copy");
  assert.equal(get(drawings).openId, copy.id);
  copy.scene.elements.push({ id: "only-in-copy" });
  const original = get(drawings).items.find((d) => d.id === from.id);
  assert.equal(original.scene.elements.length, 1, "the copy is deep, not shared");
});

test("deleting the open drawing opens its neighbour; deleting the last leaves a fresh one", () => {
  const { drawings } = setup();
  const first = drawings.current();
  const second = drawings.create();
  drawings.remove(second.id);
  assert.equal(get(drawings).openId, first.id);
  drawings.remove(first.id);
  const state = get(drawings);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].name, "Drawing 3");
  assert.equal(state.openId, state.items[0].id);
});

test("only drawings with elements count as open work", () => {
  const { documents, drawings } = setup();
  const counts = [];
  documents.openCounts.subscribe((c) => counts.push(c));
  const first = drawings.current();
  drawings.create();
  drawings.change(first.id, { scene: scene(1), files: {} });
  assert.deepEqual(counts.at(-1), { drawing: 1 });
  drawings.change(first.id, { scene: scene(0), files: {} });
  assert.deepEqual(counts.at(-1), { drawing: 0 });
});

test("another project starts afresh; the same project keeps its drawings", () => {
  const { documents, drawings } = setup();
  drawings.rename(drawings.current().id, "Kept");
  documents.useProject("/p/one.marasi");
  assert.equal(drawings.current().name, "Kept");
  documents.useProject("/p/two.marasi");
  assert.deepEqual(get(drawings).items.map((d) => d.name), ["Drawing 1"]);
});

test("a second document kind sits beside drawings with its own emptiness rule", () => {
  const documents = createToolDocuments({
    drawing: drawingKind,
    recipe: { noun: "Recipe", blank: () => ({ input: "" }), isEmpty: (doc) => !doc.input },
  });
  documents.useProject("/p/one.marasi");
  const recipes = documents.kind("recipe");
  assert.equal(recipes.current().name, "Recipe 1");
  recipes.change(recipes.current().id, { input: "aGk=" });
  assert.deepEqual(get(documents.openCounts), { drawing: 0, recipe: 1 });
});

test("a new drawing has no Artifacts, and a copy doesn't take its original's", () => {
  const { drawings } = setup();
  const from = drawings.current();
  assert.deepEqual(from.attached, {});
  const artifact = { kind: "finding", recordId: "f1", artifactId: "a1", filename: "Drawing-1.excalidraw.svg" };
  drawings.change(from.id, { scene: scene(1), attached: { "finding:f1": artifact } });
  const copy = drawings.duplicate(from.id);
  assert.deepEqual(copy.attached, {});
  const original = get(drawings).items.find((d) => d.id === from.id);
  assert.deepEqual(original.attached, { "finding:f1": artifact });
});

function recipeSetup() {
  const documents = createToolDocuments({ drawing: drawingKind, recipe: recipeKind });
  documents.useProject("/p/one.marasi");
  return { documents, recipes: documents.kind("recipe") };
}

test("a recipe starts with no operations and one empty input tab", () => {
  const { recipes } = recipeSetup();
  assert.equal(recipes.current().name, "Recipe 1");
  assert.deepEqual(recipes.current().operations, []);
  assert.deepEqual(recipes.current().inputs, [""]);
});

test("two recipes keep their own operations and inputs across switching", () => {
  const { recipes } = recipeSetup();
  const first = recipes.current();
  recipes.change(first.id, { operations: [{ op: "From Base64", args: [] }], inputs: ["aGk=", "eW8="] });
  const second = recipes.create();
  recipes.change(second.id, { operations: [{ op: "To Hex", args: [] }], inputs: ["abc"] });
  recipes.open(first.id);
  assert.deepEqual(recipes.current().operations, [{ op: "From Base64", args: [] }]);
  assert.deepEqual(recipes.current().inputs, ["aGk=", "eW8="]);
  recipes.open(second.id);
  assert.deepEqual(recipes.current().inputs, ["abc"]);
});

test("only a recipe with an operation or some input is open work", () => {
  const { documents, recipes } = recipeSetup();
  const first = recipes.current();
  recipes.change(first.id, { operations: [], inputs: ["", ""] });
  assert.deepEqual(get(documents.openCounts), { drawing: 0, recipe: 0 });
  recipes.change(first.id, { operations: [], inputs: ["", "x"] });
  assert.deepEqual(get(documents.openCounts), { drawing: 0, recipe: 1 });
  const second = recipes.create();
  recipes.change(second.id, { operations: [{ op: "To Hex", args: [] }], inputs: [""] });
  assert.deepEqual(get(documents.openCounts), { drawing: 0, recipe: 2 });
});

test("duplicate copies a document without its Artifacts", () => {
  const { recipes } = recipeSetup();
  const first = recipes.current();
  recipes.change(first.id, {
    operations: [{ op: "URL Decode", args: [] }],
    inputs: ["a%20b"],
    attached: { "finding:7": { artifactId: 12, filename: "Recipe 1.cyberchef.txt" } },
  });
  const copy = recipes.duplicate(first.id);
  assert.equal(recipes.current().id, copy.id);
  assert.equal(copy.name, "Recipe 1 copy");
  assert.deepEqual(copy.operations, [{ op: "URL Decode", args: [] }]);
  assert.deepEqual(copy.inputs, ["a%20b"]);
  assert.deepEqual(copy.attached, {});
  recipes.open(first.id);
  assert.equal(Object.keys(recipes.current().attached).length, 1, "the original keeps its Artifacts");
});

test("a binding stays live until the project changes, so a late write can be dropped", () => {
  const { documents, drawings } = setup();
  const link = drawings.bind();
  assert.equal(link.live(), true);
  documents.useProject("/p/one.marasi");
  assert.equal(link.live(), true, "the same project (a reconnect) keeps it live");
  documents.useProject("/p/two.marasi");
  assert.equal(link.live(), false);
  assert.equal(drawings.bind().live(), true);
});
