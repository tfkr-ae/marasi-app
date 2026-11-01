// Reports: Marasi's template lists in v1's shape (names), and v1's
// ReportMetadata as the body of POST /report.

/** The names in a template list ({items: [{name, size}]}), as v1's ListTemplates. */
export const templateNames = (list) => (list?.items ?? []).map((item) => item.name);

const pad = (n) => String(n).padStart(2, "0");

/**
 * `date` as RFC3339 in this machine's zone, with its offset
 * ("2026-11-01T12:00:00+05:45"). Marasi keeps the offset, so the report
 * prints the researcher's time wherever the instance runs.
 */
export function localTimestamp(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`
  );
}

/**
 * The body of POST /report for `template` and v1's report metadata, whose
 * start and end are YYYY-MM-DD. As v1, test cases are left out only when
 * custom_properties.include_test_cases is false.
 */
export function reportBody(template, metadata) {
  const custom = metadata.custom_properties ?? {};
  return {
    template,
    title: metadata.title ?? "",
    client: metadata.client ?? "",
    type: metadata.type ?? "",
    scope: metadata.scope ?? "",
    assessor: metadata.assessor ?? "",
    start: metadata.start,
    end: metadata.end,
    is_draft: Boolean(metadata.is_draft),
    truncate_length: Number(metadata.truncate_length) || 0,
    include_test_cases: custom.include_test_cases !== false,
    created_at: localTimestamp(new Date(metadata.created_at ?? Date.now())),
    custom_properties: custom,
  };
}

/**
 * The name a report is offered under: its title with the template's
 * extension once, as v1, or the template's own name without a title.
 */
export function reportFilename(template, title) {
  if (!title) return template;
  const dot = template.lastIndexOf(".");
  const ext = dot > 0 ? template.slice(dot) : "";
  return ext && !title.endsWith(ext) ? title + ext : title;
}
