import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_TYPE_GROUPS,
  DEFAULT_EXCLUSION,
  groupState,
  isDefaultExclusion,
  toggleGroup,
  toggleType,
  typeLists,
} from "./ledgerContentTypes.js";

const group = (label) => CONTENT_TYPE_GROUPS.find((g) => g.label === label);
const types = (list) => list.map((e) => e.contentType);

test("every default-excluded type belongs to exactly one group", () => {
  for (const t of DEFAULT_EXCLUSION) {
    const owners = CONTENT_TYPE_GROUPS.filter((g) => g.types.includes(t));
    assert.equal(owners.length, 1, `${t} is in ${owners.map((g) => g.label).join(", ") || "no group"}`);
  }
});

test("no type is in two groups", () => {
  const all = CONTENT_TYPE_GROUPS.flatMap((g) => g.types);
  assert.equal(new Set(all).size, all.length);
});

test("a group is shown, partial or hidden by how many of its types are excluded", () => {
  const scripts = group("Scripts");
  assert.equal(groupState(scripts, []), "shown");
  assert.equal(groupState(scripts, ["application/javascript"]), "partial");
  assert.equal(groupState(scripts, scripts.types), "hidden");
});

test("toggling a shown group hides all its types and keeps other exclusions", () => {
  const next = toggleGroup(group("Styles"), ["image/png"]);
  assert.deepEqual(next, ["image/png", "text/css"]);
});

test("toggling a partial group shows all its types", () => {
  const next = toggleGroup(group("Scripts"), ["application/javascript", "image/png"]);
  assert.deepEqual(next, ["image/png"]);
});

test("toggling a type flips only that type", () => {
  assert.deepEqual(toggleType("text/css", ["image/png"]), ["image/png", "text/css"]);
  assert.deepEqual(toggleType("image/png", ["image/png", "text/css"]), ["text/css"]);
});

test("the default exclusion is recognised in any order", () => {
  assert.ok(isDefaultExclusion([...DEFAULT_EXCLUSION].reverse()));
  assert.ok(!isDefaultExclusion([...DEFAULT_EXCLUSION, "text/html"]));
});

test("a new project's stored default, which repeats video/x-msvideo, is the default", () => {
  assert.ok(isDefaultExclusion([...DEFAULT_EXCLUSION, "video/x-msvideo"]));
});

const counts = [
  { ContentType: "application/json", Count: 9 },
  { ContentType: "text/html", Count: 4 },
  { ContentType: "image/png", Count: 6 },
  { ContentType: "text/css", Count: 2 },
  { ContentType: "", Count: 1 },
];

test("shown and hidden lists are sorted by pair count; excluded types without traffic are idle", () => {
  const lists = typeLists(counts, ["image/png", "text/css", "font/woff2"]);
  assert.deepEqual(types(lists.shown), ["application/json", "text/html", ""]);
  assert.deepEqual(types(lists.hidden), ["image/png", "text/css"]);
  assert.deepEqual(types(lists.idle), ["font/woff2"]);
});

test("find matches a type or its group label, ignoring case", () => {
  assert.deepEqual(types(typeLists(counts, [], "HTML").shown), ["text/html"]);
  assert.deepEqual(types(typeLists(counts, [], "images").shown), ["image/png"]);
});

test("a full type that is in no list can be added", () => {
  assert.equal(typeLists(counts, [], "application/x-protobuf").addable, "application/x-protobuf");
  assert.equal(typeLists(counts, [], "text/html").addable, null);
  assert.equal(typeLists(counts, [], "protobuf").addable, null);
});

test("with the default exclusion, groups made only of default types read as hidden", () => {
  for (const label of ["Images", "Fonts", "Media", "Documents", "Archives & binary", "Styles"]) {
    assert.equal(groupState(group(label), DEFAULT_EXCLUSION), "hidden", label);
  }
});
