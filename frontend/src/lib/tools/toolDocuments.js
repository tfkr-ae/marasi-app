// The tool pages' documents (GLOSSARY: Drawing, Recipe), held per project
// and in memory only. This module is the only code a Marasi document store
// replaces later (.scratch/integrated-tools/spec.md, "Later"); pages use the
// collections it hands out and never keep documents themselves.
//
// A kind describes one document type:
//   { noun, blank() → the kind's own fields, isEmpty(doc) }
// Every document has { id, name, attached } beside those fields. `attached`
// maps "<record kind>:<record id>" to the Artifact the document made there
// (attachments.js); a duplicate starts with none. `kind(name)` returns
// that kind's collection, a Svelte store of { items, openId } with
// create, open, rename, duplicate, remove and change. `openCounts` is a
// store of { <kind>: number of non-empty documents }, which the app reports
// to Go so switching the project or quitting can ask first.
import { derived, get, writable } from "svelte/store";

export const drawingKind = {
  noun: "Drawing",
  blank: () => ({ scene: null, files: {} }),
  isEmpty: (doc) => !doc.scene?.elements?.some((element) => !element.isDeleted),
};

// A Recipe keeps CyberChef's operations (its recipe config) and its input
// tabs, never its output.
export const recipeKind = {
  noun: "Recipe",
  blank: () => ({ operations: [], inputs: [""] }),
  isEmpty: (doc) => !doc.operations?.length && !(doc.inputs ?? []).some((input) => input.length),
};

function createCollection(kindName, kind, newId) {
  const blankDocument = (number) => ({
    id: newId(kindName),
    name: `${kind.noun} ${number}`,
    attached: {},
    ...kind.blank(),
  });
  const fresh = () => {
    const first = blankDocument(1);
    return { items: [first], openId: first.id, made: 1 };
  };
  const store = writable(fresh());

  const update = (fn) => store.update((state) => fn(state) ?? state);
  const replace = (id, fn) =>
    update((state) => ({ ...state, items: state.items.map((doc) => (doc.id === id ? fn(doc) : doc)) }));

  return {
    subscribe: (run) => store.subscribe(({ items, openId }) => run({ items, openId })),
    reset: () => store.set(fresh()),
    current() {
      const { items, openId } = get(store);
      return items.find((doc) => doc.id === openId) ?? items[0];
    },
    create() {
      let made;
      update((state) => {
        made = blankDocument(state.made + 1);
        return { items: [...state.items, made], openId: made.id, made: state.made + 1 };
      });
      return made;
    },
    open(id) {
      update((state) => (state.items.some((doc) => doc.id === id) ? { ...state, openId: id } : state));
    },
    rename(id, name) {
      const trimmed = name?.trim();
      if (trimmed) replace(id, (doc) => ({ ...doc, name: trimmed }));
    },
    duplicate(id) {
      let made;
      update((state) => {
        const index = state.items.findIndex((doc) => doc.id === id);
        if (index === -1) return state;
        const from = state.items[index];
        // A copy has no Artifacts: those belong to the document that made them.
        made = { ...structuredClone(from), id: newId(kindName), name: `${from.name} copy`, attached: {} };
        const items = [...state.items];
        items.splice(index + 1, 0, made);
        return { ...state, items, openId: made.id };
      });
      return made;
    },
    remove(id) {
      update((state) => {
        const index = state.items.findIndex((doc) => doc.id === id);
        if (index === -1) return state;
        const items = state.items.filter((doc) => doc.id !== id);
        if (!items.length) {
          const next = blankDocument(state.made + 1);
          return { items: [next], openId: next.id, made: state.made + 1 };
        }
        const openId =
          state.openId === id ? items[Math.min(index, items.length - 1)].id : state.openId;
        return { ...state, items, openId };
      });
    },
    // Records a document's new content: the kind's own fields, such as a
    // drawing's { scene, files }.
    change(id, fields) {
      replace(id, (doc) => ({ ...doc, ...fields }));
    },
  };
}

export function createToolDocuments(kinds) {
  let nextId = 1;
  const newId = (kindName) => `${kindName}-${nextId++}`;
  const collections = Object.fromEntries(
    Object.entries(kinds).map(([name, kind]) => [name, createCollection(name, kind, newId)]),
  );
  let project = null;

  const openCounts = derived(Object.values(collections), (states) =>
    Object.fromEntries(
      Object.keys(collections).map((name, i) => [
        name,
        states[i].items.filter((doc) => !kinds[name].isEmpty(doc)).length,
      ]),
    ),
  );

  return {
    kind(name) {
      const collection = collections[name];
      if (!collection) throw new Error(`unknown tool document kind: ${name}`);
      return collection;
    },
    openCounts,
    // The documents belong to the open project: another project starts with
    // a fresh set, and reopening the same one (a reconnect) keeps them.
    useProject(path) {
      if (path === project) return;
      project = path;
      for (const collection of Object.values(collections)) collection.reset();
    },
  };
}
