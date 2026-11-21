// The tool pages' Switch, Rename and Delete prompts, over one toolDocuments
// collection. `noun` is "drawing" or "recipe".
import { get } from "svelte/store";
import DocumentSwitcher from "./DocumentSwitcher.svelte";
import DeleteDocument from "./DeleteDocument.svelte";

const capitalised = (noun) => noun.charAt(0).toUpperCase() + noun.slice(1);

export function switchDocument(modalStore, documents, noun, toggleAction) {
  modalStore.trigger({
    type: "component",
    component: { ref: DocumentSwitcher, props: { documents, noun } },
    toggleAction,
  });
}

export function renameDocument(modalStore, documents, id, noun) {
  const doc = get(documents).items.find((d) => d.id === id);
  if (!doc) return;
  modalStore.trigger({
    type: "prompt",
    title: `Rename ${noun}`,
    value: doc.name,
    valueAttr: { type: "text", required: true },
    buttonTextSubmit: "Rename",
    response: (name) => {
      if (typeof name === "string") documents.rename(id, name);
    },
  });
}

// An empty document goes at once; one with content asks first, and one
// with Artifacts asks whether to remove them too (DeleteDocument.svelte).
export function deleteDocument(modalStore, documents, id, noun, isEmpty) {
  const doc = get(documents).items.find((d) => d.id === id);
  if (!doc) return;
  if (Object.keys(doc.attached ?? {}).length) {
    modalStore.trigger({
      type: "component",
      component: { ref: DeleteDocument, props: { documents, docId: id, noun } },
    });
    return;
  }
  if (isEmpty(doc)) {
    documents.remove(id);
    return;
  }
  modalStore.trigger({
    type: "confirm",
    title: `Delete ${noun}?`,
    body: `${doc.name} will be gone.`,
    buttonTextConfirm: `Delete ${capitalised(noun)}`,
    response: (confirmed) => {
      if (confirmed) documents.remove(id);
    },
  });
}
