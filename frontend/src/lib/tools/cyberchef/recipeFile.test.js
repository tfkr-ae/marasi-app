import { test } from "node:test";
import assert from "node:assert/strict";
import { recipeFile } from "./recipeFile.js";

const recipe = {
  name: "JWT payload",
  operations: [{ op: "From Base64", args: ["A-Za-z0-9+/=", true, false] }],
  inputs: ["aGVsbG8=", "d29ybGQ="],
};

test("a recipe's file holds its input tabs, its recipe as JSON, and the open tab's output", async () => {
  const file = recipeFile(recipe, { output: "world", openTab: 2 });
  assert.equal(file.name, "JWT-payload.cyberchef.txt");
  assert.equal(file.type, "text/plain");
  assert.equal(
    await file.text(),
    [
      "# JWT payload",
      "",
      "## Input",
      "",
      "--- Input 1 ---",
      "aGVsbG8=",
      "",
      "--- Input 2 ---",
      "d29ybGQ=",
      "",
      "## Recipe",
      "",
      "[",
      "  {",
      '    "op": "From Base64",',
      '    "args": [',
      '      "A-Za-z0-9+/=",',
      "      true,",
      "      false",
      "    ]",
      "  }",
      "]",
      "",
      "## Output of input 2",
      "",
      "world",
      "",
    ].join("\n"),
  );
});

test("a blank name still gives a file name", () => {
  assert.equal(recipeFile({ ...recipe, name: "  " }, { output: "", openTab: 1 }).name, "recipe.cyberchef.txt");
});
