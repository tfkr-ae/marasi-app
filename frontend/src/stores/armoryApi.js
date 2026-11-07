// The Armory's api over the service client: each call reads a control API
// route and maps its snake_case answer to the shapes createArmoryStore and
// the Armory's components read (the old bindings' PascalCase). The keys keep
// the old binding names, so the store's logic is unchanged. The mappers for
// stream events (toTemplate, toRun, toWordlists) live here too; traffic
// events use trafficApi.js's toRequestEvent and toResponseEvent.
//
// Calls with no single route are composed: a template from a pair (GET
// /traffic/{id}, then POST /armory/template), the active runs (each
// template's runs; Marasi has no project-wide list yet), and the run's
// traffic and group counts (GET /traffic narrowed to the run's metadata).

import { decodeBase64Text } from "../lib/service/bytes.js";

/** The most pairs one GET /traffic page holds. */
export const TRAFFIC_PAGE_LIMIT = 500;

/** A template, from a template route or armory.template.* events. */
export function toTemplate(template) {
  return {
    ID: template.id,
    Name: template.name,
    Description: template.description ?? "",
    RawTemplate: template.raw_template ?? "",
  };
}

/** A run, from a run route or armory.run.* events. */
export function toRun(run) {
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

/** The wordlists, from GET /wordlist or wordlist.* events. */
export function toWordlists(list) {
  return (list?.items ?? []).map((item) => ({ Name: item.name, Size: item.size }));
}

/** Whether a run is sending requests. */
export const isActiveRun = (run) => run.Status === "in_progress";

/** A pair in a traffic page, in the row fields the run table reads. */
export function toPairSummary(pair) {
  return {
    ID: pair.id,
    Number: pair.number,
    Scheme: pair.scheme,
    Method: pair.method,
    Host: pair.host,
    Path: pair.path,
    Status: pair.status,
    StatusCode: pair.status_code,
    ContentType: pair.content_type,
    Length: pair.length,
    Metadata: pair.metadata ?? {},
    RequestedAt: pair.requested_at,
    RespondedAt: pair.responded_at ?? null,
    Highlight: pair.highlight ?? null,
    UpstreamProxy: pair.upstream_proxy ?? null,
  };
}

/** The traffic query for the pairs the run `runId` sent. */
export function runQuery(runId, narrowing = "") {
  const query = `metadata.armory_run_id = ${JSON.stringify(String(runId))}`;
  return narrowing ? `${query} AND (${narrowing})` : query;
}

const templatePath = (id) => `/armory/template/${encodeURIComponent(id)}`;
const runPath = (id) => `/armory/run/${encodeURIComponent(id)}`;

export function createArmoryApi(client) {
  async function templateSummaries() {
    const list = await client.get("/armory/template");
    return list?.items ?? [];
  }

  async function runsOf(templateId) {
    const list = await client.get(`${templatePath(templateId)}/run`);
    return (list?.items ?? []).map(toRun);
  }

  async function createTemplate(name, description, rawTemplate) {
    return toTemplate(await client.post("/armory/template", { name, description, raw_template: rawTemplate }));
  }

  // One GET /traffic page; Limit over the service's cap reads several.
  async function queryPage(query, req) {
    const want = req.Limit > 0 ? req.Limit : TRAFFIC_PAGE_LIMIT;
    const items = [];
    let cursor = req.Cursor || undefined;
    let asOf = req.AsOf || undefined;
    let page;
    do {
      page = await client.get("/traffic", {
        q: query,
        order_by: req.OrderBy || "requested_at",
        cursor,
        direction: req.Direction || undefined,
        as_of: asOf,
        limit: Math.min(want - items.length, TRAFFIC_PAGE_LIMIT),
      });
      // Each page comes in reverse display order.
      items.push(...[...(page.items ?? [])].reverse().map(toPairSummary));
      cursor = page.next_cursor ?? undefined;
      asOf = asOf ?? page.as_of ?? undefined;
    } while (cursor && items.length < want);
    return {
      Items: items,
      NextCursor: page.next_cursor ?? null,
      AsOf: asOf ?? "",
      IndexComplete: page.index?.complete !== false,
    };
  }

  return {
    async GetArmoryTemplates() {
      const summaries = await templateSummaries();
      return Promise.all(summaries.map(async (t) => toTemplate(await client.get(templatePath(t.id)))));
    },
    CreateArmoryTemplate: createTemplate,
    // A template from the pair's request, named after it.
    async CreateArmoryTemplateFromRequest(requestId) {
      const pair = await client.get(`/traffic/${encodeURIComponent(requestId)}`);
      const { method, host, path, raw } = pair.request;
      return createTemplate(`${method} ${host}${path}`, "Imported from request history", decodeBase64Text(raw));
    },
    async UpdateArmoryTemplate(id, name, description, rawTemplate) {
      return toTemplate(await client.post(templatePath(id), { name, description, raw_template: rawTemplate }));
    },
    DeleteArmoryTemplate: (id) => client.del(templatePath(id)),

    GetArmoryRuns: runsOf,
    GetArmoryRun: async (id) => toRun(await client.get(runPath(id))),
    // Gathered from every template's runs (no project-wide route yet).
    async GetActiveArmoryRunIDs() {
      const summaries = await templateSummaries();
      const runs = (await Promise.all(summaries.map((t) => runsOf(t.id)))).flat();
      return runs.filter(isActiveRun).map((r) => r.ID);
    },
    ValidateArmoryRun: (rawTemplate, attackType, wordlists, maxConcurrent) =>
      client.post("/armory/run/validate", {
        raw_template: rawTemplate,
        attack_type: attackType,
        wordlists,
        max_concurrent: maxConcurrent,
      }),
    async CreateArmoryRun(templateId, attackType, useHTTPS, wordlists, maxConcurrent) {
      return toRun(
        await client.post("/armory/run", {
          template_id: templateId,
          attack_type: attackType,
          use_https: useHTTPS,
          wordlists,
          max_concurrent: maxConcurrent,
        }),
      );
    },
    StartArmoryRun: async (id) => toRun(await client.post(`${runPath(id)}/start`)),
    CancelArmoryRun: async (id) => toRun(await client.post(`${runPath(id)}/cancel`)),
    DeleteArmoryRun: (id) => client.del(runPath(id)),

    GetArmoryWordlists: async () => toWordlists(await client.get("/wordlist")),
    async PreviewArmoryWordlist(name, limit) {
      const preview = await client.get(`/wordlist/${encodeURIComponent(name)}`, { limit });
      return preview?.items ?? [];
    },

    // The run's pairs, whatever their content type, narrowed by req.Query.
    QueryArmoryRunTraffic: (runId, req = {}) => queryPage(runQuery(runId, req.Query), req),
    // The run's pairs counted by `field` up to asOf ("" for the newest).
    async CountArmoryRunTraffic(runId, field, asOf = "") {
      const counts = await client.get("/traffic/count/by-field", {
        q: runQuery(runId),
        field,
        as_of: asOf || undefined,
      });
      return {
        Counts: (counts?.items ?? []).map((c) => ({ Value: c.value, Count: c.count })),
        AsOf: counts?.as_of ?? "",
      };
    },
  };
}
