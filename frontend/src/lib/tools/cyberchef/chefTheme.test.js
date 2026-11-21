import { test } from "node:test";
import assert from "node:assert/strict";
import { chefTheme } from "./chefTheme.js";

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
