// CyberChef restyled to the app: its CSS variables mapped from the app's
// surface and primary colours, its dark or classic theme with the app's mode,
// and the Text size as a zoom on its panes. `read(name)` reads one of the
// app's palette variables (Skeleton's space-separated RGB channels), as
// getComputedStyle(document.body).getPropertyValue does.

function colours(read, dark) {
  const c = (name) => `rgb(${read(name).trim().split(/\s+/).join(" ")})`;
  return dark
    ? {
        bg: c("--color-surface-900"),
        bg2: c("--color-surface-800"),
        border: c("--color-surface-700"),
        fg: c("--color-surface-50"),
        sub: c("--color-surface-300"),
        accent: c("--color-primary-500"),
      }
    : {
        bg: c("--color-surface-50"),
        bg2: c("--color-surface-100"),
        border: c("--color-surface-300"),
        fg: c("--color-surface-900"),
        sub: c("--color-surface-600"),
        accent: c("--color-primary-600"),
      };
}

/**
 * The stylesheet for CyberChef's document and the theme class for its root.
 * `scale` is the app's Text size scale (lib/textSize.js).
 */
export function chefTheme(read, { dark, scale = 1 }) {
  const s = colours(read, dark);
  const vars = {
    "--primary-background-colour": s.bg,
    "--secondary-background-colour": s.bg2,
    "--primary-border-colour": s.border,
    "--secondary-border-colour": s.border,
    "--table-border-colour": s.border,
    "--title-background-colour": s.bg2,
    "--title-colour": s.fg,
    "--primary-font-colour": s.fg,
    "--subtext-font-colour": s.sub,
    "--banner-bg-colour": s.bg2,
    "--banner-font-colour": s.fg,
    "--banner-url-colour": s.accent,
    "--op-list-operation-bg-colour": s.bg2,
    "--op-list-operation-font-colour": s.fg,
    "--op-list-operation-border-colour": s.border,
    "--rec-list-operation-bg-colour": s.bg,
    "--rec-list-operation-font-colour": s.fg,
    "--rec-list-operation-border-colour": s.border,
    "--selected-operation-bg-colour": s.bg2,
    "--selected-operation-font-color": s.accent,
    "--selected-operation-border-colour": s.accent,
    "--arg-background": s.bg,
    "--arg-border-colour": s.border,
    "--arg-font-colour": s.fg,
    "--arg-label-colour": s.accent,
    "--category-list-font-colour": s.accent,
    "--input-border-colour": s.border,
    "--popover-background": s.bg2,
    "--popover-border-colour": s.border,
    "--btn-default-bg-colour": s.bg2,
    "--btn-default-font-colour": s.fg,
    "--btn-default-border-colour": s.border,
    "--btn-default-hover-bg-colour": s.border,
    "--btn-default-hover-font-colour": s.fg,
    "--btn-default-hover-border-colour": s.border,
    "--btn-success-bg-colour": s.accent,
    "--btn-success-border-colour": s.accent,
    "--btn-success-hover-bg-colour": s.accent,
    "--btn-success-hover-border-colour": s.accent,
    "--scrollbar-track": s.bg,
    "--scrollbar-thumb": s.border,
    "--scrollbar-hover": s.sub,
  };
  const declarations = Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  const css = [
    `html { zoom: ${scale}; }`,
    `:root, :root.classic, :root.dark { ${declarations} }`,
    // No Download, and no links out to GitHub (About keeps GCHQ's licence text).
    `a[data-target="#download-modal"], a[href*="github.com"] { display: none !important; }`,
  ].join("\n");
  return { themeClass: dark ? "dark" : "classic", css };
}
