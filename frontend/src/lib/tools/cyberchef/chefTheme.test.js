import { test } from "node:test";
import assert from "node:assert/strict";
import { chefColumns, chefTheme } from "./chefTheme.js";

// The app's palette as document.body's computed style gives it: Skeleton's
// space-separated RGB channels.
const palette = {
  "--color-surface-50": "250 249 247",
  "--color-surface-100": "240 238 234",
  "--color-surface-200": "225 222 216",
  "--color-surface-300": "205 201 194",
  "--color-surface-600": "90 86 80",
  "--color-surface-700": "62 59 55",
  "--color-surface-800": "40 38 36",
  "--color-surface-900": "24 23 22",
  "--color-primary-500": "200 40 40",
  "--color-primary-600": "170 30 30",
};
const read = (name) => ` ${palette[name] ?? ""} `;

function variable(css, name) {
  return css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
}

test("dark mode uses CyberChef's dark theme over the app's dark surfaces and primary colour", () => {
  const { themeClass, css } = chefTheme(read, { dark: true });
  assert.equal(themeClass, "dark");
  assert.equal(variable(css, "--primary-background-colour"), "rgb(24 23 22)");
  assert.equal(variable(css, "--secondary-background-colour"), "rgb(40 38 36)");
  assert.equal(variable(css, "--primary-font-colour"), "rgb(250 249 247)");
  assert.equal(variable(css, "--primary-border-colour"), "rgb(62 59 55)");
  assert.equal(variable(css, "--btn-success-bg-colour"), "rgb(200 40 40)");
});

test("light mode uses CyberChef's classic theme over the app's light surfaces", () => {
  const { themeClass, css } = chefTheme(read, { dark: false });
  assert.equal(themeClass, "classic");
  assert.equal(variable(css, "--primary-background-colour"), "rgb(250 249 247)");
  assert.equal(variable(css, "--secondary-background-colour"), "rgb(240 238 234)");
  assert.equal(variable(css, "--primary-font-colour"), "rgb(24 23 22)");
  assert.equal(variable(css, "--btn-success-bg-colour"), "rgb(170 30 30)");
});

test("the theme hides CyberChef's GitHub and Download links", () => {
  const { css } = chefTheme(read, { dark: true });
  // The banner's Download link opens #download-modal; GitHub links sit in About.
  assert.match(css, /a\[data-target="#download-modal"\][^{]*\{[^}]*display:\s*none/);
  assert.match(css, /a\[href\*="github\.com"\][^{]*\{[^}]*display:\s*none/);
});

test("text size scales CyberChef's panes", () => {
  assert.match(chefTheme(read, { dark: true, scale: 1.25 }).css, /html\s*\{\s*zoom:\s*1\.25;/);
  assert.match(chefTheme(read, { dark: true }).css, /html\s*\{\s*zoom:\s*1;/);
});

const near = (actual, expected) =>
  assert.deepEqual(actual.map((n) => Math.round(n * 10) / 10), expected);

test("columns keep CyberChef's widths where its least widths fit", () => {
  // 1508 px of room: 20% and 30% are over their least widths.
  near(chefColumns(1516), [20, 30, 50]);
  // 1008 px of room: Operations and Recipe at their least, Input/Output the rest.
  near(chefColumns(1016), [23.8, 30.8, 45.4]);
});

test("columns share a frame too narrow for CyberChef's least widths", () => {
  // A tablet's frame at X-Large: 1030 / 1.25 leaves 816 px, under 1000.
  const sizes = chefColumns(1030, 1.25);
  near(sizes, [24, 31, 45]);
  assert.equal(Math.round(sizes.reduce((a, b) => a + b, 0)), 100);
  // The Recipe column keeps its share, not what the other two left.
  assert.ok((sizes[1] / 100) * (1030 / 1.25 - 8) > 250);
});

test("a larger Text size leaves less room for the same frame", () => {
  near(chefColumns(1300, 1), [20, 30, 50]);
  near(chefColumns(1300, 1.25), [23.3, 30, 46.7]);
});
