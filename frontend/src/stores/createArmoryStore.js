// The Armory's store. armoryStore.js binds it to the Marasi bindings; tests
// load it with a fake API holding the same binding names. lib/marasiEvents.js
// passes it Marasi's armory.* and wordlist.* events.
import { writable } from "svelte/store";
import { clampDrawerSplit } from "./createLedgerStore.js";
import { createRunTrafficView } from "./createArmoryRunTraffic.js";

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
    activeRunIds: [],
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

export function createArmoryStore(api) {
  const {
    CancelArmoryRun,
    CreateArmoryRun,
    CreateArmoryTemplate,
    CreateArmoryTemplateFromRequest,
    DeleteArmoryRun,
    DeleteArmoryTemplate,
    GetActiveArmoryRunIDs,
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
  const { subscribe, set, update } = writable(initialState());
  // The selected run's traffic: its sorted rows, read a page at a time, and
  // the pair open in the drawer (createArmoryRunTraffic.js). armoryStore.js
  // flushes its buffered events.
  const runTraffic = createRunTrafficView({
    queryRunTraffic: (runId, req) => QueryArmoryRunTraffic(runId, req),
    countRunTraffic: (runId, field) => CountArmoryRunTraffic(runId, field),
  });

  function upsertRun(run) {
    update((state) => {
      const runs = state.runsByTemplate[run.TemplateID] || [];
      const exists = runs.some((item) => item.ID === run.ID);

      return {
        ...state,
        runsByTemplate: {
          ...state.runsByTemplate,
          [run.TemplateID]: exists
            ? runs.map((item) => (item.ID === run.ID ? run : item))
            : [...runs, run],
        },
      };
    });
  }

  // Drops a run from its template's runs and from any run selection.
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
        activeRunIds: state.activeRunIds.filter((runId) => runId !== id),
      };
    });
  }

  // Drops a template, its runs and settings, and the selection of it.
  function withoutTemplate(state, id) {
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

  async function populate() {
    const version = projectStateVersion;
    const templates = (await GetArmoryTemplates()) || [];
    if (version !== projectStateVersion) return;
    set({
      ...initialState(version),
      templates: sortTemplates(templates),
    });

    const [wordlists, activeRunIds] = await Promise.all([
      GetArmoryWordlists(),
      GetActiveArmoryRunIDs(),
    ]);
    if (version !== projectStateVersion) return;

    update((state) => ({
      ...state,
      wordlists: wordlists || [],
      activeRunIds: activeRunIds || [],
    }));
  }

  // Reads the instance again after the event stream reopens, keeping the
  // open template, its unsaved draft and the run settings; the runs of each
  // template read before are read again.
  async function reload() {
    const version = projectStateVersion;
    const [templates, wordlists, activeRunIds] = await Promise.all([
      GetArmoryTemplates(),
      GetArmoryWordlists(),
      GetActiveArmoryRunIDs(),
    ]);
    if (version !== projectStateVersion) return;
    const present = new Set((templates || []).map((template) => template.ID));
    let loaded = [];
    update((state) => {
      let next = {
        ...state,
        templates: sortTemplates(templates || []),
        wordlists: wordlists || [],
        activeRunIds: activeRunIds || [],
      };
      for (const id of Object.keys(state.runsByTemplate)) {
        if (!present.has(id)) next = withoutTemplate(next, id);
      }
      if (next.selectedTemplateId != null && !present.has(next.selectedTemplateId)) {
        next = withoutTemplate(next, next.selectedTemplateId);
      }
      loaded = Object.keys(next.runsByTemplate);
      return next;
    });
    await Promise.all(loaded.map((id) => loadRuns(id)));
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

  async function refreshActiveRuns() {
    const version = projectStateVersion;
    const activeRunIds = (await GetActiveArmoryRunIDs()) || [];
    if (version !== projectStateVersion) return null;
    update((state) => ({ ...state, activeRunIds }));
    return activeRunIds;
  }

  return {
    subscribe,
    runTraffic,
    onRequest: (req) => runTraffic.onRequest(req),
    onResponse: (res) => runTraffic.onResponse(res),
    // armory.run.created and armory.run.updated: the run's progress, from
    // draft through in progress to complete, failed or cancelled.
    onRun: (run) => {
      upsertRun(run);
      update((state) => {
        const others = state.activeRunIds.filter((id) => id !== run.ID);
        return {
          ...state,
          activeRunIds: run.Status === "in_progress" ? [...others, run.ID] : others,
        };
      });
    },
    onRunDeleted: ({ ID }) => removeRun(ID),
    onTemplate: (template) => upsertTemplate(template),
    onTemplateDeleted: ({ ID }) => update((state) => withoutTemplate(state, ID)),
    onWordlists: (wordlists) => update((state) => ({ ...state, wordlists })),

    clear: () => {
      runTraffic.clear();
      set(initialState(++projectStateVersion));
    },
    populate,
    reload,

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
      update((state) => withoutTemplate(state, id));
    },

    loadRuns,
    refreshRun,

    validateRun: ({ rawTemplate, attackType, wordlists, maxConcurrent }) =>
      ValidateArmoryRun(
        rawTemplate,
        attackType,
        wordlists,
        maxConcurrent,
      ),

    createRun: async ({
      templateId,
      attackType,
      useHTTPS = false,
      wordlists = [],
      maxConcurrent = 1,
    }) => {
      const run = await CreateArmoryRun(
        templateId,
        attackType,
        useHTTPS,
        wordlists,
        maxConcurrent,
      );
      upsertRun(run);
      return run;
    },

    startRun: async (id) => {
      await StartArmoryRun(id);
      const [run] = await Promise.all([refreshRun(id), refreshActiveRuns()]);
      return run;
    },

    cancelRun: async (id) => {
      await CancelArmoryRun(id);
    },

    deleteRun: async (id) => {
      await DeleteArmoryRun(id);
      removeRun(id);
    },

    refreshActiveRuns,

    loadWordlists: async () => {
      const wordlists = (await GetArmoryWordlists()) || [];
      update((state) => ({ ...state, wordlists }));
      return wordlists;
    },

    previewWordlist: (name, limit = 20) => PreviewArmoryWordlist(name, limit),
  };
}
