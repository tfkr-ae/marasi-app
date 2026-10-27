// The CVSS 3.1 calculator's logic, shared by every place a finding is scored.
import { CVSS31 } from "@pandatix/js-cvss";

/** The metric values a first pick fills in for an unscored finding. */
export const CVSS_DEFAULTS = Object.freeze({ AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "H", I: "H", A: "H" });

const KEYS = Object.keys(CVSS_DEFAULTS);

/** The eight base metrics as the calculator groups them, each option as [value, label]. */
export const CVSS_GROUPS = [
  {
    name: "Exploitability",
    metrics: [
      { key: "AV", name: "Attack vector", options: [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]] },
      { key: "AC", name: "Attack complexity", options: [["L", "Low"], ["H", "High"]] },
      { key: "PR", name: "Privileges required", options: [["N", "None"], ["L", "Low"], ["H", "High"]] },
      { key: "UI", name: "User interaction", options: [["N", "None"], ["R", "Required"]] },
    ],
  },
  {
    name: "Impact",
    metrics: [
      { key: "S", name: "Scope", options: [["U", "Unchanged"], ["C", "Changed"]] },
      { key: "C", name: "Confidentiality", options: [["N", "None"], ["L", "Low"], ["H", "High"]] },
      { key: "I", name: "Integrity", options: [["N", "None"], ["L", "Low"], ["H", "High"]] },
      { key: "A", name: "Availability", options: [["N", "None"], ["L", "Low"], ["H", "High"]] },
    ],
  },
];

/**
 * The eight base metrics and score of a vector. A vector that isn't CVSS 3.1
 * scores null and reads as the defaults.
 */
export function parseCvss(vector) {
  if (!vector || !vector.includes("CVSS:3.1")) return { selections: { ...CVSS_DEFAULTS }, score: null };
  try {
    const parsed = new CVSS31(vector);
    const m = parsed._metrics ?? {};
    const selections = Object.fromEntries(KEYS.map((k) => [k, m[k] || CVSS_DEFAULTS[k]]));
    const score = parsed.BaseScore();
    return { selections, score: isNaN(score) ? null : score };
  } catch {
    return { selections: { ...CVSS_DEFAULTS }, score: null };
  }
}

export { severityFromScore } from "./severity.js";

/** A pasted vector to override the current one, or why it can't. */
export function pasteCvss(text) {
  const vector = (text ?? "").trim();
  if (parseCvss(vector).score === null) return { error: "Not a CVSS 3.1 vector" };
  return { vector };
}

/** The vector after picking one metric: all eight, the rest from the current vector or the defaults. */
export function pickCvss(vector, key, value) {
  const s = { ...parseCvss(vector).selections, [key]: value };
  return `CVSS:3.1/${KEYS.map((k) => `${k}:${s[k]}`).join("/")}`;
}
