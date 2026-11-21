// Putting a tool document back on a finding or test case as an Artifact
// (spec: Putting work back). Any kind of document works: a Drawing's SVG or
// PNG, a Recipe's text. A document remembers, in `attached`, the Artifact
// it made on each record, so attaching again replaces only that one (a
// delete, then an upload: Artifacts can't change in place). Artifacts
// uploaded by hand are never touched.
//
// `createDocumentArtifacts(api)` takes { upload(kind, recordId, file) →
// { ID, Filename }, remove(artifactId), bind() }; each call's steps go to
// the connection it began on, and one the connection moved past rejects as
// superseded (boundAction.js). `documentArtifacts` (toolItems.js)
// binds it to the Logbook's artifact API. The document's `attached` map is
// its persisted shape: { "<kind>:<id>": { kind, recordId, artifactId,
// filename } }.
import { boundAction } from "../service/boundAction.js";
import { recordLabel } from "./recordKinds.js";

export const recordKey = (kind, id) => `${kind}:${id}`;

// An Artifact that is already gone (removed in the Logbook, or with its
// record) needs no removing.
const isGone = (err) => err?.status === 404;

export function createDocumentArtifacts(api) {
  async function removeArtifact(action, id) {
    try {
      await action.step(() => api.remove(id));
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }

  return {
    /** The Artifact `doc` made on `record` ({ kind, id }), or null. */
    previous(doc, record) {
      return doc.attached?.[recordKey(record.kind, record.id)] ?? null;
    },

    /**
     * Uploads `file` (a File: name, type, bytes) to `record`, replacing the
     * Artifact `doc` made there before. Returns `doc`'s new `attached`.
     */
    async attach(doc, record, file) {
      const action = boundAction(api.bind?.());
      const key = recordKey(record.kind, record.id);
      const attached = { ...(doc.attached ?? {}) };
      const earlier = attached[key];
      if (earlier) {
        await removeArtifact(action, earlier.artifactId);
        delete attached[key];
      }
      const made = await action.step(() => api.upload(record.kind, record.id, file));
      attached[key] = { kind: record.kind, recordId: record.id, artifactId: made.ID, filename: made.Filename ?? file.name };
      return attached;
    },

    /** Removes every Artifact `doc` made. */
    async detachAll(doc) {
      const action = boundAction(api.bind?.());
      for (const artifact of Object.values(doc.attached ?? {})) await removeArtifact(action, artifact.artifactId);
    },
  };
}

/**
 * The records `doc` is attached to, as "Finding “Title”" or "Test case
 * (deleted)". `titleOf(kind, id)` is the record's title, or null once it is
 * gone.
 */
export function artifactRecords(doc, titleOf) {
  return Object.values(doc.attached ?? {}).map(({ kind, recordId }) => {
    const title = titleOf(kind, recordId);
    return `${recordLabel(kind)} ${title == null ? "(deleted)" : `“${title}”`}`;
  });
}
