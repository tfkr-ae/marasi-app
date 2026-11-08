// The Armory's store. armoryStore.js binds it to the service through
// armoryApi.js, whose keys keep the old binding names; tests load it with
// a fake service client or a fake API.
import { get, writable } from "svelte/store";
import { clampDrawerSplit } from "./createLedgerStore.js";
import { createRunTrafficView } from "./createArmoryRunTraffic.js";
import { boundAction } from "../lib/service/boundAction.js";
import { isActiveRun, toRun, toTemplate, toWordlists } from "./armoryApi.js";

/** How long cancelling the active runs waits for them to stop. */
export const CANCEL_TIMEOUT_MS = 5000;

function defaultRunSettings() {
  return {
    attackType: "harpoon",
    useHTTPS: true,
    selectedWordlists: [],
    maxConcurrent: 10,
  };
}

function initialState(projectStateVersion = 0) {
  return {
    projectStateVersion,
    templates: [],
    runsByTemplate: {},
    wordlists: [],
    // The runs in progress, run id → template id.
    activeRuns: {},
    search: "",
    selectedTemplateId: null,
    templateDraft: null,
    runSettingsByTemplate: {},
    selectedRunByTemplate: {},
    // The drawer's share of the workspace height, set by dragging its
    // edge; null until then (see drawerShareOf).
    drawerSplit: null,
  };
}

// The drawer's share of the workspace height: the dragged one, or else the
// open traffic section's, so opening a pair covers the table and nothing
// above it moves; 38 % while the traffic section is folded or unmeasured.
export function drawerShareOf(state, { trafficOpen, trafficHeight, workspaceHeight }) {
  if (state.drawerSplit != null) return state.drawerSplit;
  if (!trafficOpen || !trafficHeight || !workspaceHeight) return 0.38;
  return clampDrawerSplit(trafficHeight / workspaceHeight);
}

function sortTemplates(templates) {
  return [...templates].sort((left, right) => {
    if (left.ID === right.ID) return 0;
    return left.ID < right.ID ? -1 : 1;
  });
}

// The active set from GET /armory/run?status=in_progress: run id → template id.
const activeRunsMap = (runs) => Object.fromEntries((runs || []).map((run) => [run.ID, run.TemplateID]));

/** The ids of the runs in progress. */
export const activeRunIdsOf = (state) => Object.keys(state.activeRuns);

/** How many runs are in progress, in all and per template (the rail and the template list). */
export function activeCountsOf(state) {
  const byTemplate = {};
  for (const templateId of Object.values(state.activeRuns)) byTemplate[templateId] = (byTemplate[templateId] ?? 0) + 1;
  return { total: Object.keys(state.activeRuns).length, byTemplate };
}

export function createArmoryStore(api) {
  const {
    CancelArmoryRun,
    CreateArmoryRun,
    CreateArmoryTemplate,
    CreateArmoryTemplateFromRequest,
    DeleteArmoryRun,
    DeleteArmoryTemplate,
    GetActiveArmoryRuns,
    GetArmoryRun,
    GetArmoryRuns,
    GetArmoryTemplates,
    GetArmoryWordlists,
    QueryArmoryRunTraffic,
    CountArmoryRunTraffic,
    PreviewArmoryWordlist,
    StartArmoryRun,
    UpdateArmoryTemplate,
    ValidateArmoryRun,
  } = api;
  let projectStateVersion = 0;

  async function createRun({ templateId, attackType, useHTTPS = false, wordlists = [], maxConcurrent = 1 }) {
    const run = await CreateArmoryRun(templateId, attackType, useHTTPS, wordlists, maxConcurrent);
    upsertRun(run);
    return run;
  }

  async function startRun(id) {
    await StartArmoryRun(id);
    return refreshRun(id);
  }
  const { subscribe, set, update } = writable(initialState());
  // The selected run's traffic: its sorted rows, read a page at a time, and
  // the pair open in the drawer (createArmoryRunTraffic.js). armoryStore.js
  // flushes its buffered events.
  const runTraffic = createRunTrafficView({
    queryRunTraffic: (runId, req) => QueryArmoryRunTraffic(runId, req),
    countRunTraffic: (runId, field) => CountArmoryRunTraffic(runId, field),
  });

  // Adds or replaces a run in its template's runs, when those are loaded
  // or `always`, and keeps the active runs in step with its status.
  function upsertRun(run, { always = true } = {}) {
    update((state) => {
      const loaded = state.runsByTemplate[run.TemplateID];
      const runs = loaded || [];
      const exists = runs.some((item) => item.ID === run.ID);
      const { [run.ID]: _, ...activeRuns } = state.activeRuns;
      if (isActiveRun(run)) activeRuns[run.ID] = run.TemplateID;

      return {
        ...state,
        activeRuns,
        runsByTemplate: !loaded && !always
          ? state.runsByTemplate
          : {
              ...state.runsByTemplate,
              [run.TemplateID]: exists
                ? runs.map((item) => (item.ID === run.ID ? run : item))
                : [...runs, run],
            },
      };
    });
  }

  // Forgets a run, and its selection.
  function removeRun(id) {
    update((state) => {
      const selectedRunByTemplate = Object.fromEntries(
        Object.entries(state.selectedRunByTemplate).map(
          ([templateId, runId]) => [templateId, runId === id ? null : runId],
        ),
      );
      const runsByTemplate = Object.fromEntries(
        Object.entries(state.runsByTemplate).map(([templateId, runs]) => [
          templateId,
          runs.filter((run) => run.ID !== id),
        ]),
      );
      return {
        ...state,
        runsByTemplate,
        selectedRunByTemplate,
        activeRuns: Object.fromEntries(Object.entries(state.activeRuns).filter(([runId]) => runId !== id)),
      };
    });
  }

  // Forgets a template, its runs and what the page kept for it.
  function removeTemplate(id) {
    update((state) => {
      const runsByTemplate = { ...state.runsByTemplate };
      const runSettingsByTemplate = { ...state.runSettingsByTemplate };
      const selectedRunByTemplate = { ...state.selectedRunByTemplate };
      delete runsByTemplate[id];
      delete runSettingsByTemplate[id];
      delete selectedRunByTemplate[id];
      return {
        ...state,
        templates: state.templates.filter((template) => template.ID !== id),
        runsByTemplate,
        runSettingsByTemplate,
        selectedRunByTemplate,
        selectedTemplateId:
          state.selectedTemplateId === id ? null : state.selectedTemplateId,
        templateDraft:
          state.templateDraft?.templateId === id ? null : state.templateDraft,
      };
    });
  }

  function upsertTemplate(template) {
    update((state) => {
      const exists = state.templates.some((item) => item.ID === template.ID);
      return {
        ...state,
        templates: sortTemplates(
          exists
            ? state.templates.map((item) =>
                item.ID === template.ID ? template : item,
              )
            : [...state.templates, template],
        ),
      };
    });
  }

  // Reads the templates, wordlists and active runs together.
  async function populate() {
    const version = projectStateVersion;
    const [templates, wordlists, activeRuns] = await Promise.all([
      GetArmoryTemplates(),
      GetArmoryWordlists(),
      GetActiveArmoryRuns(),
    ]);
    if (version !== projectStateVersion) return;
    set({
      ...initialState(version),
      templates: sortTemplates(templates || []),
      wordlists: wordlists || [],
      activeRuns: activeRunsMap(activeRuns),
    });
  }

  async function loadRuns(templateId) {
    const version = projectStateVersion;
    const runs = (await GetArmoryRuns(templateId)) || [];
    if (version !== projectStateVersion) return [];
    update((state) => ({
      ...state,
      runsByTemplate: {
        ...state.runsByTemplate,
        [templateId]: runs,
      },
    }));
    return runs;
  }

  async function refreshRun(id) {
    const version = projectStateVersion;
    const run = await GetArmoryRun(id);
    if (version !== projectStateVersion) return run;
    upsertRun(run);
    return run;
  }

  // Reads the service's data again in place after a stream reset: the
  // templates, wordlists, active runs, the runs already loaded and the open
  // run's traffic. What only the app holds stays: the selection, the
  // template draft, run settings, search and the drawer.
  async function resync() {
    const version = projectStateVersion;
    const loadedTemplateIds = Object.keys(get({ subscribe }).runsByTemplate);
    const [templates, wordlists, activeRuns, runs] = await Promise.all([
      GetArmoryTemplates(),
      GetArmoryWordlists(),
      GetActiveArmoryRuns(),
      Promise.all(loadedTemplateIds.map((id) => GetArmoryRuns(id).catch(() => null))),
    ]);
    if (version !== projectStateVersion) return;
    const known = new Set((templates || []).map((template) => template.ID));
    update((state) => {
      const runsByTemplate = {};
      loadedTemplateIds.forEach((id, i) => {
        if (known.has(id)) runsByTemplate[id] = runs[i] || state.runsByTemplate[id] || [];
      });
      return {
        ...state,
        templates: sortTemplates(templates || []),
        wordlists: wordlists || [],
        activeRuns: activeRunsMap(activeRuns),
        runsByTemplate,
      };
    });
    for (const id of Object.keys(get({ subscribe }).runSettingsByTemplate)) {
      if (!known.has(id)) removeTemplate(id);
    }
    const state = get({ subscribe });
    if (state.selectedTemplateId && !known.has(state.selectedTemplateId)) removeTemplate(state.selectedTemplateId);
    await runTraffic.showNew();
  }

  // Cancels every active run, read afresh from the service, and waits until
  // none is running, or rejects after timeoutMs. A run that stopped on its
  // own before its cancel is fine.
  async function cancelActiveRuns({
    timeoutMs = CANCEL_TIMEOUT_MS,
    pollMs = 100,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = {}) {
    let running = (await refreshActiveRuns()) ?? [];
    await Promise.all(
      running.map((id) =>
        CancelArmoryRun(id).catch((err) => {
          if (err?.code !== "run_not_active") throw err;
        }),
      ),
    );
    const deadline = now() + timeoutMs;
    while (running.length > 0) {
      const runs = await Promise.all(running.map((id) => refreshRun(id)));
      running = runs.filter(isActiveRun).map((run) => run.ID);
      if (running.length === 0) break;
      if (now() >= deadline) throw new Error("timed out cancelling active Armory runs");
      await sleep(pollMs);
    }
  }

  async function refreshActiveRuns() {
    const version = projectStateVersion;
    const activeRuns = activeRunsMap(await GetActiveArmoryRuns());
    if (version !== projectStateVersion) return null;
    update((state) => ({ ...state, activeRuns }));
    return Object.keys(activeRuns);
  }

  return {
    subscribe,
    runTraffic,
    onRequest: (req) => runTraffic.onRequest(req),
    onResponse: (res) => runTraffic.onResponse(res),

    clear: () => {
      runTraffic.clear();
      set(initialState(++projectStateVersion));
    },
    populate,
    resync,

    setSearch: (search) => update((state) => ({ ...state, search })),

    selectTemplate: (template) => {
      let selection;
      update((state) => {
        const templateId = template.ID;
        const sameTemplate = state.selectedTemplateId === templateId;
        const settings =
          state.runSettingsByTemplate[templateId] || defaultRunSettings();
        const templateDraft =
          sameTemplate && state.templateDraft?.templateId === templateId
            ? state.templateDraft
            : {
                templateId,
                name: template.Name,
                description: template.Description || "",
                rawTemplate: template.RawTemplate,
              };
        selection = {
          templateDraft,
          settings,
          selectedRunId: state.selectedRunByTemplate[templateId] ?? null,
        };

        return {
          ...state,
          selectedTemplateId: templateId,
          templateDraft,
          runSettingsByTemplate: {
            ...state.runSettingsByTemplate,
            [templateId]: settings,
          },
        };
      });
      return selection;
    },

    updateTemplateDraft: (templateId, templateDraft) =>
      update((state) => {
        if (state.selectedTemplateId !== templateId) return state;
        return {
          ...state,
          templateDraft: { templateId, ...templateDraft },
        };
      }),

    updateRunSettings: (templateId, settings) =>
      update((state) => ({
        ...state,
        runSettingsByTemplate: {
          ...state.runSettingsByTemplate,
          [templateId]: { ...settings },
        },
      })),

    selectRun: (templateId, runId) =>
      update((state) => ({
        ...state,
        selectedRunByTemplate: {
          ...state.selectedRunByTemplate,
          [templateId]: runId,
        },
      })),

    // Dragging the drawer's top edge; the share lasts until a new project.
    setDrawerSplit: (split) =>
      update((state) => ({ ...state, drawerSplit: clampDrawerSplit(split) })),

    createTemplate: async ({ name, description = "", rawTemplate }) => {
      const template = await CreateArmoryTemplate(
        name,
        description,
        rawTemplate,
      );
      upsertTemplate(template);
      return template;
    },

    createTemplateFromRequest: async (requestId) => {
      const template = await CreateArmoryTemplateFromRequest(requestId);
      upsertTemplate(template);
      return template;
    },

    updateTemplate: async (id, { name, description = "", rawTemplate }) => {
      await UpdateArmoryTemplate(id, name, description, rawTemplate);
      update((state) => ({
        ...state,
        templates: state.templates.map((template) =>
          template.ID === id
            ? {
                ...template,
                Name: name,
                Description: description,
                RawTemplate: rawTemplate,
              }
            : template,
        ),
      }));
    },

    deleteTemplate: async (id) => {
      await DeleteArmoryTemplate(id);
      removeTemplate(id);
    },

    loadRuns,
    refreshRun,

    // The service's armory.* and wordlist.* events, in the API's shapes.
    onTemplate: (template) => upsertTemplate(toTemplate(template)),
    onTemplateDeleted: ({ id }) => removeTemplate(id),
    onRun: (run) => upsertRun(toRun(run), { always: false }),
    onRunDeleted: ({ id }) => removeRun(id),
    onWordlists: (list) => update((state) => ({ ...state, wordlists: toWordlists(list) })),

    validateRun: ({ rawTemplate, attackType, wordlists, maxConcurrent }) =>
      ValidateArmoryRun(
        rawTemplate,
        attackType,
        wordlists,
        maxConcurrent,
      ),

    createRun,
    startRun,

    /**
     * Saves the template (`save()`, resolving false to stop), creates the
     * run, tells `created(run)`, and with `start` starts it: one action on
     * the connection it began on (boundAction.js), so a switch on the way
     * stops it with a superseded error. Resolves to the run, or null when
     * `save` stopped it.
     */
    launchRun: async (run, { save = async () => true, start = false, created = () => {} } = {}) => {
      const action = boundAction(api.bind?.());
      if (!(await action.step(save))) return null;
      const made = await action.step(() => createRun(run));
      created(made);
      if (start) await action.step(() => startRun(made.ID));
      return made;
    },

    cancelRun: async (id) => {
      await CancelArmoryRun(id);
    },

    deleteRun: async (id) => {
      await DeleteArmoryRun(id);
      removeRun(id);
    },

    refreshActiveRuns,
    cancelActiveRuns,

    loadWordlists: async () => {
      const wordlists = (await GetArmoryWordlists()) || [];
      update((state) => ({ ...state, wordlists }));
      return wordlists;
    },

    previewWordlist: (name, limit = 20) => PreviewArmoryWordlist(name, limit),
  };
}
