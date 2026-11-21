import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createRecipes, nonEmptyRecipes } from "./recipes.js";

const names = (store) => get(store).items.map((recipe) => recipe.name);
const open = (store) => store.current();

test("a project starts with one empty recipe, and New Recipe opens the next", () => {
  const recipes = createRecipes();
  assert.deepEqual(names(recipes), ["Recipe 1"]);
  assert.deepEqual(open(recipes).operations, []);
  assert.deepEqual(open(recipes).inputs, [""]);

  const made = recipes.create();
  assert.deepEqual(names(recipes), ["Recipe 1", "Recipe 2"]);
  assert.equal(open(recipes).id, made.id);
});

test("two recipes keep their own operations and inputs across switching", () => {
  const recipes = createRecipes();
  const first = open(recipes);
  recipes.change(first.id, { operations: [{ op: "From Base64", args: [] }], inputs: ["aGk=", "eW8="] });
  const second = recipes.create();
  recipes.change(second.id, { operations: [{ op: "To Hex", args: [] }], inputs: ["abc"] });

  recipes.open(first.id);
  assert.deepEqual(open(recipes).operations, [{ op: "From Base64", args: [] }]);
  assert.deepEqual(open(recipes).inputs, ["aGk=", "eW8="]);
  recipes.open(second.id);
  assert.deepEqual(open(recipes).operations, [{ op: "To Hex", args: [] }]);
  assert.deepEqual(open(recipes).inputs, ["abc"]);
});

test("Duplicate copies a recipe's operations and inputs without its Artifacts, and opens the copy", () => {
  const recipes = createRecipes();
  const first = open(recipes);
  recipes.change(first.id, { operations: [{ op: "URL Decode", args: [] }], inputs: ["a%20b"] });
  recipes.setAttached(first.id, { "finding:7": { artifactId: 12, filename: "Recipe 1.cyberchef.txt" } });

  const copy = recipes.duplicate(first.id);
  assert.deepEqual(names(recipes), ["Recipe 1", "Recipe 1 copy"]);
  assert.equal(open(recipes).id, copy.id);
  assert.deepEqual(open(recipes).operations, [{ op: "URL Decode", args: [] }]);
  assert.deepEqual(open(recipes).inputs, ["a%20b"]);
  assert.deepEqual(open(recipes).attached, {});

  // The copy is its own: changing it leaves the original alone.
  recipes.change(copy.id, { operations: [], inputs: ["x"] });
  recipes.open(first.id);
  assert.deepEqual(open(recipes).inputs, ["a%20b"]);
  assert.equal(Object.keys(open(recipes).attached).length, 1);
});

test("Rename names a recipe, and a blank name keeps the old one", () => {
  const recipes = createRecipes();
  const first = open(recipes);
  recipes.rename(first.id, "  JWT body  ");
  assert.deepEqual(names(recipes), ["JWT body"]);
  recipes.rename(first.id, "   ");
  assert.deepEqual(names(recipes), ["JWT body"]);
});

test("Delete opens a neighbour, and deleting the last recipe leaves a new empty one", () => {
  const recipes = createRecipes();
  const first = open(recipes);
  const second = recipes.create();
  const third = recipes.create();
  recipes.open(second.id);

  recipes.remove(second.id);
  assert.deepEqual(names(recipes), ["Recipe 1", "Recipe 3"]);
  assert.equal(open(recipes).id, third.id);

  recipes.remove(third.id);
  assert.equal(open(recipes).id, first.id);
  recipes.remove(first.id);
  assert.deepEqual(names(recipes), ["Recipe 4"]);
  assert.deepEqual(open(recipes).inputs, [""]);
});

test("only recipes with operations or input count as non-empty", () => {
  const recipes = createRecipes();
  assert.equal(nonEmptyRecipes(get(recipes)), 0);
  const first = open(recipes);
  recipes.change(first.id, { operations: [], inputs: ["", ""] });
  assert.equal(nonEmptyRecipes(get(recipes)), 0);
  recipes.change(first.id, { operations: [], inputs: ["", "x"] });
  assert.equal(nonEmptyRecipes(get(recipes)), 1);
  const second = recipes.create();
  recipes.change(second.id, { operations: [{ op: "To Hex", args: [] }], inputs: [""] });
  assert.equal(nonEmptyRecipes(get(recipes)), 2);
});

test("reset drops every recipe, for the next project", () => {
  const recipes = createRecipes();
  recipes.change(open(recipes).id, { operations: [], inputs: ["x"] });
  recipes.create();
  recipes.reset();
  assert.deepEqual(names(recipes), ["Recipe 1"]);
  assert.equal(nonEmptyRecipes(get(recipes)), 0);
});

test("recipes belong to the project they were made in", () => {
  const recipes = createRecipes();
  recipes.forProject("/p/a.marasi");
  recipes.change(open(recipes).id, { operations: [], inputs: ["from a"] });
  recipes.forProject("/p/a.marasi");
  assert.deepEqual(open(recipes).inputs, ["from a"], "the same project keeps its recipes");
  recipes.forProject("/p/b.marasi");
  assert.deepEqual(names(recipes), ["Recipe 1"]);
  assert.deepEqual(open(recipes).inputs, [""]);
});
