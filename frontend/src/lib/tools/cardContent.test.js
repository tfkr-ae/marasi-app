import { test } from "node:test";
import assert from "node:assert/strict";
import { cardContent } from "./cardContent.js";
import { SEVERITY_BADGE } from "../logbook/severityColors.js";
import { METHOD_CLASS, statusClass, tertiaryVariant } from "../launchpad/format.js";

const palette = [{ number: 2, label: "Auth", color: "#7c3aed" }];
const texts = (content) => content.chips.map((chip) => chip.text);

test("a pair card shows number, method, status and highlight, then path, host and the facts line", () => {
  const pair = {
    ID: "p1", Number: 42, Method: "POST", StatusCode: 302, Highlight: 2, Scheme: "https", Host: "api.example.com",
    Path: "/login?next=/", ContentType: "text/html; charset=utf-8", Length: 2048, ClientProtocol: "h2", OriginProtocol: "http/1.1",
  };
  const content = cardContent({ kind: "pair", id: "p1" }, pair, { palette, light: true });
  assert.equal(content.label, "Pair");
  assert.deepEqual(texts(content), ["#42", "POST", "302", "Auth"]);
  assert.equal(content.chips[1].classes, METHOD_CLASS.POST);
  assert.ok(content.chips[2].classes.includes(statusClass(302)));
  assert.equal(content.chips[3].color, "#7c3aed");
  assert.equal(content.accent.color, "#7c3aed");
  assert.deepEqual(content.title, { text: "/login?next=/", mono: true });
  assert.equal(content.lines[0].text, "https://api.example.com");
  assert.equal(content.footer, "html · 2.0 KB · h2→1.1");
});

test("a pending pair says so", () => {
  const content = cardContent({ kind: "pair", id: "p1" }, { Number: 1, Method: "GET", StatusCode: 0, Path: "/" }, { palette });
  assert.equal(texts(content)[2], "pending");
});

test("a finding card shows its severity badge, CVSS, title, write-up and counts", () => {
  const finding = {
    ID: "f1", Title: "SQL injection in login", Severity: "Critical", CVSSScore: 9.81, WriteUp: "The  username\nfield is concatenated",
    Requests: ["a", "b"], Artifacts: [{ ID: "x" }],
  };
  const content = cardContent({ kind: "finding", id: "f1" }, finding, { palette });
  assert.equal(content.label, "Finding");
  assert.deepEqual(texts(content), ["Critical", "CVSS 9.8"]);
  assert.equal(content.chips[0].classes, SEVERITY_BADGE.Critical);
  assert.equal(content.title.text, "SQL injection in login");
  assert.equal(content.lines[0].text, "The username field is concatenated");
  assert.equal(content.footer, "2 pairs · 1 artifact");
});

test("a finding with no severity has the Logbook's no-severity badge", () => {
  const content = cardContent({ kind: "finding", id: "f2" }, { ID: "f2", Title: "Open redirect", Severity: "" });
  assert.equal(content.chips[0].text, "No severity");
  // As LogbookSummary, LogbookRecord and RecordChecklist draw it.
  assert.equal(content.chips[0].classes, "variant-soft");
});

test("a test case card shows its category in the tertiary variant, all its tags, and its counts", () => {
  const testCase = {
    ID: "t1", Title: "Login rate limit", Category: "Authentication", Tags: ["login", "rate", "brute", "extra"],
    Description: "Try 100 logins", Requests: ["a"], Artifacts: [],
  };
  const light = cardContent({ kind: "testCase", id: "t1" }, testCase, { palette, light: true, findingCount: 3 });
  assert.deepEqual(texts(light), ["Authentication", "#login", "#rate", "#brute", "#extra"]);
  assert.equal(light.chips[0].classes, tertiaryVariant(true));
  assert.equal(light.footer, "1 pair · 3 findings · 0 artifacts");
  const dark = cardContent({ kind: "testCase", id: "t1" }, testCase, { palette, light: false });
  assert.equal(dark.chips[0].classes, tertiaryVariant(false));
});

test("a card whose source is gone is marked deleted", () => {
  const content = cardContent({ kind: "finding", id: "f1" }, null, { palette });
  assert.equal(content.deleted, true);
  assert.equal(content.title.text, "Deleted");
  assert.deepEqual(content.chips, []);
});
