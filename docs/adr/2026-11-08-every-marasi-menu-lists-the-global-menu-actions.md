# Every Marasi menu lists the global menu actions

A page's Marasi menu (⌘K) lists the page's own menu actions under a heading named after the page, then a Marasi section with the global menu groups (Go to, Project, Browser & proxy, Appearance) and Jump to Toast. `GlobalMenu.svelte` publishes the global entries, with their icons and live names such as the intercept toggle, and every page-tier and overlay-tier menu lists them. The global-tier menu (Home, Settings) shows only the Marasi section.

This reverses a deliberate rule. Until now, ⌘K opened the most specific mounted menu, and a page's menu listed only that page's actions. A page with its own menu kept its list short and focused on the page, and the global actions stayed reachable by their shortcuts, since the `global` context is eligible on every page.

We reversed it because a short, flat list was the only reason for the rule, and menu groups remove that reason. With the old rule, going to another page, opening a project, Connections, starting Chrome, the certificate, intercept, the theme and text size were reachable on every page with a menu only by shortcuts the researcher already had to know. A menu that hides what the app can do can't teach it. Menu groups fold each global group into one row, so the Marasi section adds five rows, and the page's actions stay first.

The menu-registration mechanism doesn't change: `menuPalettes` and the context tiers still decide which mounted menu ⌘K opens. Because the top level holds both sections, a page group's menu letter must not be a global group's letter (G, P, B or A); `catalog.test.js` enforces it, and the menu model gives a global group its key before any page action.
