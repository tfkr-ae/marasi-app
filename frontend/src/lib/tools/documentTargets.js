// The Add to Drawing and Send to CyberChef submenus of the row and entry
// menus (ledger/rowMenu.js, launchpad/entryMenu.js) and the editor
// selection menu: New <noun>, then every document of the kind, as Send to
// Launchpad offers New launchpad and the launchpads. Plain functions, so
// they load under node.
//
// Each leaf's action is `action` with `target`: a document id, or "new".

/**
 * A submenu item `{ id, label, icon, sub }` over `documents`, a toolDocuments
 * collection's state ({ items, openId }). `noun` words New ("drawing");
 * `actionId` goes on the open document's item, which the action's shortcut
 * reaches; `off` is a hint that disables the whole submenu.
 */
export function documentTargetItem({ id, label, icon, noun, documents, action, actionId, off = null }) {
  const items = documents?.items ?? [];
  const openId = documents?.openId ?? items[0]?.id;
  return {
    id,
    label,
    icon,
    ...(off ? { disabled: true, hint: off } : {}),
    sub: [
      { id: `${id}-new`, label: `New ${noun}`, icon: "plus", action: { ...action, target: "new" } },
      ...(items.length ? ["sep"] : []),
      ...items.map((doc) => ({
        id: `${id}-${doc.id}`,
        label: doc.name,
        ...(doc.id === openId ? { count: "open", actionId } : {}),
        action: { ...action, target: doc.id },
      })),
    ],
  };
}
