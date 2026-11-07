// The Logbook's api over the service client: findings, test cases, their
// links and artifacts, the linked pairs, and report export. Each call maps
// the control API's snake_case answer to the PascalCase records
// createLogbookStore keeps (what the bindings gave before), so the store and
// the components read the same fields.
//
// The service lists findings and test cases as summaries only, so a full
// list reads each record (GET /finding/{id}) until Marasi adds a route that
// lists them in full (Todo Board). Files reach the disk through `saveFile`,
// the Go SaveFileAs binding: (title, defaultName, filterName, filterPattern,
// contentBase64) -> saved path, or "" when cancelled.

import { toDetails } from "./trafficApi.js";

/** How many records a full list reads at once. */
const READ_AT_ONCE = 8;

/** An artifact's metadata, from the service's artifact. */
export function toArtifact(a) {
  return {
    ID: a.id,
    Filename: a.filename,
    MimeType: a.mime_type,
    Size: a.size,
    TestCaseID: a.test_case_id ?? null,
    FindingID: a.finding_id ?? null,
    CreatedAt: a.created_at,
  };
}

const linksOf = (record) => ({
  Requests: (record.items ?? []).map((item) => item.id),
  Artifacts: (record.artifacts ?? []).map(toArtifact),
});

/** A finding, from GET /finding/{id} (with items and artifacts) or a write. */
export function toFinding(f) {
  return {
    ID: f.id,
    TestCaseID: f.test_case_id ?? null,
    Title: f.title,
    Severity: f.severity,
    CVSSVector: f.cvss_vector ?? "",
    CVSSScore: f.cvss_score ?? 0,
    WriteUp: f.writeup ?? "",
    TreatmentPlan: f.treatment_plan ?? "",
    CreatedAt: f.created_at,
    ...linksOf(f),
  };
}

/** A test case, from GET /test-case/{id} (with items and artifacts) or a write. */
export function toTestCase(t) {
  return {
    ID: t.id,
    Title: t.title,
    Description: t.description ?? "",
    Category: t.category ?? "",
    Tags: t.tags ?? [],
    Note: t.note ?? "",
    CreatedAt: t.created_at,
    ...linksOf(t),
  };
}

/** Bytes as standard base64. */
export function bytesBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The route each kind lives under.
const ROUTE = { finding: "/finding", testCase: "/test-case" };

// Reads every record of `kind` in full, a few at a time. A record deleted
// since the list is left out.
async function readAll(client, kind, map) {
  const list = await client.get(ROUTE[kind]);
  const ids = (list?.items ?? []).map((item) => item.id);
  const records = new Array(ids.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const at = next++;
      records[at] = await client
        .get(`${ROUTE[kind]}/${ids[at]}`)
        .then(map)
        .catch(() => null);
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, ids.length) }, worker));
  return records.filter(Boolean);
}

const findingFields = (f) => ({
  title: f.Title,
  severity: f.Severity ?? "",
  // The service works the score out from the vector.
  cvss_vector: f.CVSSVector ?? "",
  writeup: f.WriteUp ?? "",
  treatment_plan: f.TreatmentPlan ?? "",
  test_case_id: f.TestCaseID || null,
});

const testCaseFields = (t) => ({
  title: t.Title,
  description: t.Description ?? "",
  category: t.Category ?? "",
  tags: t.Tags ?? [],
  note: t.Note ?? "",
});

/** The report body POST /report takes, from the export's details. */
export function reportBody(template, metadata) {
  const day = (value) => String(value ?? "").slice(0, 10);
  const custom = metadata.custom_properties ?? {};
  return {
    template,
    title: metadata.title,
    client: metadata.client,
    type: metadata.type,
    scope: metadata.scope,
    assessor: metadata.assessor,
    start: day(metadata.start),
    end: day(metadata.end),
    is_draft: metadata.is_draft !== false,
    truncate_length: Number(metadata.truncate_length) || 0,
    include_test_cases: custom.include_test_cases !== false,
    created_at: metadata.created_at ?? new Date().toISOString(),
    custom_properties: custom,
  };
}

/** The report's file name: its title, with the template's extension once. */
export function reportFilename(template, title) {
  const at = template.lastIndexOf(".");
  const ext = at > 0 ? template.slice(at) : "";
  return ext && !title.endsWith(ext) ? `${title}${ext}` : title;
}

export function createLogbookApi(client, { saveFile }) {
  const draft = (kind, body, requestIds, map) => async () => {
    const created = map(await client.post(ROUTE[kind], body));
    for (const id of requestIds ?? []) await client.post(`${ROUTE[kind]}/${created.ID}/traffic`, { id });
    return { ...created, Requests: [...(requestIds ?? [])] };
  };
  const upload = (kind) => async (id, file) =>
    toArtifact(
      await client.request("POST", `${ROUTE[kind]}/${id}/artifact`, {
        query: { filename: file.name },
        raw: file,
        contentType: file.type || "application/octet-stream",
      }),
    );
  const artifactWithBytes = async (id) => {
    const [meta, bytes] = await Promise.all([
      client.get(`/artifact/${id}`),
      client.request("GET", `/artifact/${id}/content`, { as: "bytes" }),
    ]);
    return { ...toArtifact(meta), Data: bytes };
  };

  return {
    listFindings: () => readAll(client, "finding", toFinding),
    listTestCases: () => readAll(client, "testCase", toTestCase),
    getFinding: async (id) => toFinding(await client.get(`/finding/${id}`)),
    getTestCase: async (id) => toTestCase(await client.get(`/test-case/${id}`)),
    getPair: async (id) => toDetails(await client.get(`/traffic/${id}`)),
    getArtifact: artifactWithBytes,
    async downloadArtifact(id) {
      const artifact = await artifactWithBytes(id);
      return !!(await saveFile("Save Artifact", artifact.Filename, "", "", bytesBase64(artifact.Data)));
    },
    // Drafts as the Go bindings made them; Save writes the real fields next.
    createDraftFinding: (requestIds, testCaseId) =>
      draft(
        "finding",
        {
          title: "Draft Finding",
          severity: "High",
          writeup: "Writeup",
          ...(testCaseId ? { test_case_id: testCaseId } : {}),
        },
        requestIds,
        toFinding,
      )(),
    createDraftTestCase: (requestIds) =>
      draft(
        "testCase",
        { title: "Draft Test Case", description: "Test Case Description", category: "XSS", tags: [], note: "Test Note" },
        requestIds,
        toTestCase,
      )(),
    saveFinding: async (f) => toFinding(await client.post(`/finding/${f.ID}`, findingFields(f))),
    saveTestCase: async (t) => toTestCase(await client.post(`/test-case/${t.ID}`, testCaseFields(t))),
    linkRequestToFinding: (id, request) => client.post(`/finding/${id}/traffic`, { id: request }),
    unlinkRequestFromFinding: (id, request) => client.del(`/finding/${id}/traffic/${request}`),
    linkRequestToTestCase: (id, request) => client.post(`/test-case/${id}/traffic`, { id: request }),
    unlinkRequestFromTestCase: (id, request) => client.del(`/test-case/${id}/traffic/${request}`),
    saveArtifactToFinding: upload("finding"),
    saveArtifactToTestCase: upload("testCase"),
    deleteArtifact: (id) => client.del(`/artifact/${id}`),
    deleteFinding: (id) => client.del(`/finding/${id}`),
    deleteTestCase: (id) => client.del(`/test-case/${id}`),

    listTemplates: async () => ((await client.get("/report/template"))?.items ?? []).map((t) => t.name),
    restoreDefaultTemplate: () => client.post("/report/template/restore"),
    // Renders the report on the service and saves it; false when cancelled.
    async exportReport(template, metadata) {
      const bytes = await client.request("POST", "/report", { body: reportBody(template, metadata), as: "bytes" });
      return !!(await saveFile("Save Report", reportFilename(template, metadata.title ?? "Report"), "", "", bytesBase64(bytes)));
    },
  };
}
