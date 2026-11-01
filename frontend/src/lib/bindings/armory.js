// Marasi's Armory payloads in the shapes v1's frontend reads: Wails sent the
// Go structs' field names.

/** A GET /armory/template/{id} answer or armory.template.* event as v1's ArmoryTemplate. */
export function armoryTemplate(template) {
  return {
    ID: template.id,
    Name: template.name,
    Description: template.description ?? "",
    RawTemplate: template.raw_template ?? "",
  };
}

/** A run, as Marasi answers and its armory.run.* events carry it, as v1's ArmoryRun. */
export function armoryRun(run) {
  return {
    ID: run.id,
    TemplateID: run.template_id,
    TemplateSnapshot: run.template_snapshot,
    UseHTTPS: run.use_https,
    Wordlists: run.wordlists ?? [],
    Status: run.status,
    AttackType: run.attack_type,
    MaxConcurrent: run.max_concurrent,
    CreatedAt: run.created_at,
    StartedAt: run.started_at ?? null,
    FinishedAt: run.finished_at ?? null,
  };
}

/** A GET /wordlist answer or wordlist.* event as v1's wordlist Infos. */
export const wordlistInfos = (list) => (list?.items ?? []).map((item) => ({ Name: item.name, Size: item.size }));
