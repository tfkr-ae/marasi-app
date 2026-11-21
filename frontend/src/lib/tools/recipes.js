// CyberChef's Recipes (GLOSSARY Recipe), in memory, for the open project.
// A recipe keeps its operations (CyberChef's recipe config) and its input
// tabs, never its output. This is the recipe half of the tool documents
// storage (issue 01's `toolDocuments`), and the only code a Marasi document
// store replaces later.
import { get, writable } from "svelte/store";

let nextId = 1;

function blankRecipe(number) {
  return { id: `recipe-${nextId++}`, name: `Recipe ${number}`, operations: [], inputs: [""], attached: {} };
}

function initialState() {
  const first = blankRecipe(1);
  return { items: [first], currentId: first.id, created: 1 };
}

export function createRecipes() {
  const store = writable(initialState());
  let owner;

  return {
    subscribe: store.subscribe,

    /** The open recipe. */
    current() {
      const state = get(store);
      return state.items.find((recipe) => recipe.id === state.currentId) ?? state.items[0];
    },

    /** New Recipe: adds an empty recipe and opens it. */
    create() {
      let made;
      store.update((state) => {
        made = blankRecipe(state.created + 1);
        return { items: [...state.items, made], currentId: made.id, created: state.created + 1 };
      });
      return made;
    },

    /** Switch Recipe. */
    open(id) {
      store.update((state) => (state.items.some((recipe) => recipe.id === id) ? { ...state, currentId: id } : state));
    },

    /** Records what CyberChef holds for a recipe: its operations and input tabs. */
    change(id, { operations, inputs }) {
      update(id, (recipe) => ({ ...recipe, operations, inputs }));
    },

    /**
     * The Artifacts a recipe made, by record ("finding:<id>" or
     * "testcase:<id>"), so attaching again replaces only its own (issue 04).
     */
    setAttached(id, attached) {
      update(id, (recipe) => ({ ...recipe, attached }));
    },

    /** Duplicate Recipe: a copy without its Artifacts, opened. */
    duplicate(id) {
      let made;
      store.update((state) => {
        const from = state.items.find((recipe) => recipe.id === id);
        if (!from) return state;
        made = {
          ...structuredClone(from),
          id: `recipe-${nextId++}`,
          name: `${from.name} copy`,
          attached: {},
        };
        return { ...state, items: [...state.items, made], currentId: made.id };
      });
      return made;
    },

    /** Rename Recipe. A blank name keeps the old one. */
    rename(id, name) {
      const trimmed = String(name ?? "").trim();
      if (trimmed) update(id, (recipe) => ({ ...recipe, name: trimmed }));
    },

    /**
     * Delete Recipe. The open one gives way to its right-hand neighbour, else
     * its left; deleting the last leaves a new empty recipe.
     */
    remove(id) {
      store.update((state) => {
        const index = state.items.findIndex((recipe) => recipe.id === id);
        if (index === -1) return state;
        const items = state.items.filter((recipe) => recipe.id !== id);
        if (!items.length) {
          const fresh = blankRecipe(state.created + 1);
          return { items: [fresh], currentId: fresh.id, created: state.created + 1 };
        }
        const currentId = state.currentId === id ? (items[index] ?? items[index - 1]).id : state.currentId;
        return { ...state, items, currentId };
      });
    },

    /** Drops every recipe: the next project starts with one empty recipe. */
    reset() {
      store.set(initialState());
    },

    /**
     * Keeps the recipes when `project` (its path) is the one they were made
     * in, else drops them: the switch prompt has already asked.
     */
    forProject(project) {
      if (project === owner) return;
      owner = project;
      store.set(initialState());
    },
  };

  function update(id, fn) {
    store.update((state) => ({ ...state, items: state.items.map((recipe) => (recipe.id === id ? fn(recipe) : recipe)) }));
  }
}

/** Whether a recipe holds anything: an operation or some input. */
export function isEmptyRecipe(recipe) {
  return !recipe.operations?.length && !(recipe.inputs ?? []).some((input) => input.length);
}

/** How many recipes would be lost on a project switch or quit. */
export function nonEmptyRecipes(state) {
  return state.items.filter((recipe) => !isEmptyRecipe(recipe)).length;
}

/** The app's recipes, for the open project. */
export const recipes = createRecipes();
