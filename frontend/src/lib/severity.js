// The severity a CVSS score sets. Apart from cvss.js so that modules loaded
// under plain node --test can use it without the CVSS package.

/**
 * The severity a score sets, or null for no score. Scores have one decimal,
 * so the bands meet: 0, 0.1–3.9, 4.0–6.9, 7.0–8.9, 9.0 and up.
 */
export function severityFromScore(score) {
  if (score === null || score === undefined || score === "") return null;
  const s = parseFloat(score);
  if (isNaN(s)) return null;
  if (s === 0) return "Informational";
  if (s >= 0.1 && s <= 3.9) return "Low";
  if (s >= 4.0 && s <= 6.9) return "Medium";
  if (s >= 7.0 && s <= 8.9) return "High";
  if (s >= 9.0) return "Critical";
  return null;
}
