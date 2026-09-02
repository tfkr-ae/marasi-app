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

const initialState = {
  templates: [],
  runsByTemplate: {},
  wordlists: [],
  activeRunIds: [],
};

function sortTemplates(templates) {
  return [...templates].sort((left, right) => {
    if (left.ID === right.ID) return 0;
    return left.ID < right.ID ? -1 : 1;
  });
}

function createArmoryStore() {
  const { subscribe, set, update } = writable(initialState);

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
    const templates = (await GetArmoryTemplates()) || [];
    set({ ...initialState, templates: sortTemplates(templates) });

    const [wordlists, activeRunIds] = await Promise.all([
      GetArmoryWordlists(),
      GetActiveArmoryRunIDs(),
    ]);

    update((state) => ({
      ...state,
      wordlists: wordlists || [],
      activeRunIds: activeRunIds || [],
    }));
  }

  async function loadRuns(templateId) {
    const runs = (await GetArmoryRuns(templateId)) || [];
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
    const run = await GetArmoryRun(id);
    upsertRun(run);
    return run;
  }

  async function refreshActiveRuns() {
    const activeRunIds = (await GetActiveArmoryRunIDs()) || [];
    update((state) => ({ ...state, activeRunIds }));
    return activeRunIds;
  }

  return {
    subscribe,

    clear: () => set(initialState),
    populate,

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
        delete runsByTemplate[id];
        return {
          ...state,
          templates: state.templates.filter((template) => template.ID !== id),
          runsByTemplate,
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
        const runsByTemplate = Object.fromEntries(
          Object.entries(state.runsByTemplate).map(([templateId, runs]) => [
            templateId,
            runs.filter((run) => run.ID !== id),
          ]),
        );
        return { ...state, runsByTemplate };
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
