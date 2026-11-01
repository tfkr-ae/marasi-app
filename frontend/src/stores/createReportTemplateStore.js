// The instance's report templates, which the export modal picks from, and
// the one picked. Each change answers the whole list, and the store follows
// the report.template.* events, so a template the CLI or another window
// adds, removes or restores shows up too.
import { writable } from "svelte/store";

/**
 * The report template store. `api` is `{list(), upload(name, bytes),
 * remove(name), restore()}`: ListTemplates, UploadReportTemplate,
 * DeleteReportTemplate and RestoreDefaultReportTemplate, each answering the
 * template names.
 */
export function createReportTemplateStore(api) {
  const store = writable({ names: [], selected: undefined, loaded: false });

  // Shows `names`, keeping the pick (or `pick`) while it is listed, and
  // otherwise the first, as v1's export did.
  const show = (names, pick) =>
    store.update(({ selected }) => {
      const wanted = pick ?? selected;
      return { names, selected: names.includes(wanted) ? wanted : names[0], loaded: true };
    });

  return {
    subscribe: store.subscribe,
    async reload() {
      show(await api.list());
    },
    select: (name) => store.update((state) => ({ ...state, selected: name })),
    /** Shows a report.template.added/removed/restored event's list. */
    onTemplates: ({ items = [] } = {}) => show(items.map((item) => item.name)),
    async upload(name, bytes) {
      show(await api.upload(name, bytes), name);
    },
    async remove(name) {
      show(await api.remove(name));
    },
    async restore() {
      show(await api.restore());
    },
  };
}
