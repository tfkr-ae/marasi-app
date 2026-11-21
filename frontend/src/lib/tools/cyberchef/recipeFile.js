// The file Attach… uploads for a Recipe: one text Artifact,
// `<recipe>.cyberchef.txt`, with its input tabs, its recipe as CyberChef's
// JSON, and the output of the open input tab. The output is never stored on
// the recipe (GLOSSARY: Recipe), so the page reads it from CyberChef first.

const baseName = (name) => String(name).trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "recipe";

/**
 * A File of `recipe` ({ name, operations, inputs }). `output` is the open
 * tab's output, and `openTab` that tab's number (1-based).
 */
export function recipeFile(recipe, { output, openTab }) {
  const inputs = (recipe.inputs ?? []).map((text, i) => `--- Input ${i + 1} ---\n${text}`).join("\n\n");
  const text = [
    `# ${recipe.name}`,
    "",
    "## Input",
    "",
    inputs,
    "",
    "## Recipe",
    "",
    JSON.stringify(recipe.operations ?? [], null, 2),
    "",
    `## Output of input ${openTab}`,
    "",
    output,
    "",
  ].join("\n");
  return new File([text], `${baseName(recipe.name)}.cyberchef.txt`, { type: "text/plain" });
}
