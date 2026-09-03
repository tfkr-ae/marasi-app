import { writable } from "svelte/store";
import {
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
  PreviewArmoryWordlist,
  StartArmoryRun,
  UpdateArmoryTemplate,
  ValidateArmoryRun,
} from "../lib/wailsjs/go/main/App";

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
    trafficPageByRun: {},
    trafficPageSize: 100,
  };
}

function sortTemplates(templates) {
  return [...templates].sort((left, right) => {
    if (left.ID === right.ID) return 0;
    return left.ID < right.ID ? -1 : 1;
  });
}

function createArmoryStore() {
  let projectStateVersion = 0;
  const { subscribe, set, update } = writable(initialState());

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

    clear: () => set(initialState(++projectStateVersion)),
    populate,

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

    setTrafficPagination: (runId, { pageIndex, pageSize }) =>
      update((state) => ({
        ...state,
        trafficPageSize: pageSize,
        trafficPageByRun: runId
          ? { ...state.trafficPageByRun, [runId]: pageIndex }
          : state.trafficPageByRun,
      })),

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
      update((state) => {
        const runsByTemplate = { ...state.runsByTemplate };
        const runSettingsByTemplate = { ...state.runSettingsByTemplate };
        const selectedRunByTemplate = { ...state.selectedRunByTemplate };
        const trafficPageByRun = { ...state.trafficPageByRun };
        for (const run of runsByTemplate[id] || []) {
          delete trafficPageByRun[run.ID];
        }
        delete runsByTemplate[id];
        delete runSettingsByTemplate[id];
        delete selectedRunByTemplate[id];
        return {
          ...state,
          templates: state.templates.filter((template) => template.ID !== id),
          runsByTemplate,
          runSettingsByTemplate,
          selectedRunByTemplate,
          trafficPageByRun,
          selectedTemplateId:
            state.selectedTemplateId === id ? null : state.selectedTemplateId,
          templateDraft:
            state.templateDraft?.templateId === id ? null : state.templateDraft,
        };
      });
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
      update((state) => {
        const selectedRunByTemplate = Object.fromEntries(
          Object.entries(state.selectedRunByTemplate).map(
            ([templateId, runId]) => [templateId, runId === id ? null : runId],
          ),
        );
        const trafficPageByRun = { ...state.trafficPageByRun };
        delete trafficPageByRun[id];
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
          trafficPageByRun,
        };
      });
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

export const armoryStore = createArmoryStore();
