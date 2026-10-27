import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

// @pandatix/js-cvss imports its own files without extensions, which Vite
// resolves and plain Node does not; add the extension for it. registerHooks
// needs Node 22.15; CI runs Node 20, which has register.
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && context.parentURL?.includes("@pandatix/js-cvss")) {
          return next(`${specifier}.js`, context);
        }
        throw err;
      }
    },
  });
} else {
  nodeModule.register("./cvssResolveHook.mjs", import.meta.url);
}

const { parseCvss, pickCvss, severityFromScore, pasteCvss } = await import("./cvss.js");

// Reflected XSS, the FIRST specification's worked example: 6.1.
const XSS = "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N";

test("a CVSS 3.1 vector reads as its eight metrics and base score", () => {
  assert.deepEqual(parseCvss(XSS), {
    selections: { AV: "N", AC: "L", PR: "N", UI: "R", S: "C", C: "L", I: "L", A: "N" },
    score: 6.1,
  });
});

test("no vector, or one that isn't CVSS 3.1, is unscored and reads as the defaults", () => {
  const unscored = {
    selections: { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "H", I: "H", A: "H" },
    score: null,
  };
  assert.deepEqual(parseCvss(""), unscored);
  assert.deepEqual(parseCvss("CVSS:3.0/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), unscored);
  assert.deepEqual(parseCvss("CVSS:3.1/AV:N"), unscored);
});

test("a pick changes one metric and keeps the other seven", () => {
  assert.equal(pickCvss(XSS, "AV", "P"), "CVSS:3.1/AV:P/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N");
});

test("the first pick on an unscored finding fills the rest with the defaults", () => {
  assert.equal(pickCvss("", "C", "L"), "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:H");
});

test("a score falls in the severity bands at their edges", () => {
  const bands = [
    [0, "Informational"],
    [0.1, "Low"],
    [3.9, "Low"],
    [4.0, "Medium"],
    [6.9, "Medium"],
    [7.0, "High"],
    [8.9, "High"],
    [9.0, "Critical"],
    [10, "Critical"],
    ["9.8", "Critical"],
  ];
  for (const [score, severity] of bands) assert.equal(severityFromScore(score), severity, `score ${score}`);
});

test("a pasted CVSS 3.1 vector is taken as it is, trimmed", () => {
  assert.deepEqual(pasteCvss(`  ${XSS}\n`), { vector: XSS });
});

test("a paste that isn't a CVSS 3.1 vector is refused", () => {
  for (const text of [
    "",
    "hello",
    "CVSS:3.0/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    "CVSS:3.1/AV:N/AC:L",
    "CVSS:3.1/AV:X/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
  ]) {
    assert.deepEqual(pasteCvss(text), { error: "Not a CVSS 3.1 vector" }, JSON.stringify(text));
  }
});

test("no score has no severity", () => {
  assert.equal(severityFromScore(null), null);
  assert.equal(severityFromScore(undefined), null);
  assert.equal(severityFromScore(""), null);
});
