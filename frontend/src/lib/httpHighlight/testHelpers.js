import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { HighlightStyle, ensureSyntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { githubLightStyle } from "@uiw/codemirror-theme-github";
import { httpHighlighting } from "../httpHighlight.js";

export const githubLightHighlightStyle = HighlightStyle.define(githubLightStyle);

export function createHttpState(doc, opts = {}) {
  const mode = "mode" in opts ? opts.mode : "auto";
  const armory = opts.armory ?? false;
  const framing = opts.framing ?? "";
  return EditorState.create({ doc, extensions: httpHighlighting({ mode, armory, framing }) });
}

export function highlightSpans(doc, opts = {}) {
  const highlighter = opts.highlighter ?? classHighlighter;
  const state = createHttpState(doc, opts);
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) return [];
  const spans = [];
  highlightTree(tree, highlighter, (from, to, classes) => {
    spans.push({ from, to, text: state.doc.sliceString(from, to), classes });
  });
  return spans;
}

export function classFor(doc, needle, options = {}) {
  const { fromIndex = 0 } = options;
  const state = createHttpState(doc, options);
  const text = state.doc.toString();
  const from = text.indexOf(needle, fromIndex);
  assert.ok(from >= 0, `needle ${JSON.stringify(needle)} not found in doc`);
  const to = from + needle.length;
  const highlighter = options.highlighter ?? classHighlighter;
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) return null;
  let found = null;
  highlightTree(tree, highlighter, (sFrom, sTo, classes) => {
    if (found === null && sFrom <= from && sTo >= to) found = classes;
  });
  return found;
}
