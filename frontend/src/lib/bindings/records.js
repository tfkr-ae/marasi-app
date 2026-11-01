// Marasi's findings, test cases and artifacts in the shapes v1's bindings
// returned (marasi's domain.Finding, domain.TestCase and
// domain.ArtifactMetadata as Wails encoded them), and the records v1's
// frontend saves as Marasi's fields.

/** An artifact as v1's ArtifactMetadata. */
export const artifactMetadata = (artifact) => ({
  ID: artifact.id,
  Filename: artifact.filename,
  MimeType: artifact.mime_type,
  Size: artifact.size,
  CreatedAt: artifact.created_at,
});

const requestsOf = (detail) => (detail.items ?? []).map((pair) => pair.id);
const artifactsOf = (detail) => (detail.artifacts ?? []).map(artifactMetadata);

/** A GET /finding/{id} answer as v1's Finding. */
export const findingRecord = (detail) => ({
  ID: detail.id,
  TestCaseID: detail.test_case_id ?? null,
  Title: detail.title,
  Requests: requestsOf(detail),
  CVSSVector: detail.cvss_vector,
  CVSSScore: detail.cvss_score,
  Severity: detail.severity,
  WriteUp: detail.writeup,
  TreatmentPlan: detail.treatment_plan,
  Artifacts: artifactsOf(detail),
  CreatedAt: detail.created_at,
});

/** A GET /test-case/{id} answer as v1's TestCase. */
export const testCaseRecord = (detail) => ({
  ID: detail.id,
  Title: detail.title,
  Description: detail.description,
  Category: detail.category,
  Tags: detail.tags ?? [],
  Requests: requestsOf(detail),
  Artifacts: artifactsOf(detail),
  Note: detail.note,
  CreatedAt: detail.created_at,
});

/** A v1 Finding's fields as POST /finding/{id} takes them. */
export const findingFields = (finding) => ({
  title: finding.Title,
  severity: finding.Severity ?? "",
  cvss_vector: finding.CVSSVector ?? "",
  cvss_score: finding.CVSSScore ?? 0,
  writeup: finding.WriteUp ?? "",
  treatment_plan: finding.TreatmentPlan ?? "",
  test_case_id: finding.TestCaseID || null,
});

/** A v1 TestCase's fields as POST /test-case/{id} takes them. */
export const testCaseFields = (testCase) => ({
  title: testCase.Title,
  description: testCase.Description ?? "",
  category: testCase.Category ?? "",
  tags: testCase.Tags ?? [],
  note: testCase.Note ?? "",
});
