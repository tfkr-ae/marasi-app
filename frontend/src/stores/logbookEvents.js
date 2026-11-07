// The service events that change the Logbook, as handlers for
// `service.on(name, handler)`: findings, test cases, their links and
// artifacts, written by any client (this app, the CLI, another device).
// Each maps the event's snake_case data and hands it to the Logbook store,
// which updates its lists in place and keeps an open edit session's input.
import { toArtifact, toFinding, toTestCase } from "./logbookApi.js";

// A record event's fields alone: the service's created and updated events
// carry no links or artifacts, so the store keeps the ones it has.
const fieldsOf = (record) => {
  const { Requests, Artifacts, ...fields } = record;
  return fields;
};

/** The handlers by event name, over the Logbook store `store`. */
export function logbookEvents(store) {
  return {
    "finding.created": (f) => store.applyRecord("finding", fieldsOf(toFinding(f))),
    "finding.updated": (f) => store.applyRecord("finding", fieldsOf(toFinding(f))),
    "test-case.created": (t) => store.applyRecord("testCase", fieldsOf(toTestCase(t))),
    "test-case.updated": (t) => store.applyRecord("testCase", fieldsOf(toTestCase(t))),
    "finding.deleted": ({ id }) => store.applyDeleted("finding", id),
    "test-case.deleted": ({ id }) => store.applyDeleted("testCase", id),
    "finding.linked": ({ finding_id, id }) => store.applyLink("finding", finding_id, id, true),
    "finding.unlinked": ({ finding_id, id }) => store.applyLink("finding", finding_id, id, false),
    "test-case.linked": ({ test_case_id, id }) => store.applyLink("testCase", test_case_id, id, true),
    "test-case.unlinked": ({ test_case_id, id }) => store.applyLink("testCase", test_case_id, id, false),
    "artifact.created": (a) => store.applyArtifact(toArtifact(a)),
    "artifact.deleted": ({ id }) => store.applyArtifactRemoved(id),
  };
}

/** Template names from GET /report/template or a report.template.* event. */
export const templateNames = (list) => (list?.items ?? []).map((t) => t.name);

/**
 * The handlers for the report template events, which carry the whole list
 * after an add, remove or restore anywhere: each hands `onChange` the names.
 */
export function reportTemplateEvents(onChange) {
  const changed = (list) => onChange(templateNames(list));
  return {
    "report.template.added": changed,
    "report.template.removed": changed,
    "report.template.restored": changed,
  };
}

/** The template to show chosen: `current` while `names` lists it, else the first. */
export const keptTemplate = (names, current) => (names.includes(current) ? current : names[0]);
