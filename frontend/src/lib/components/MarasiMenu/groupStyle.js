// The icon and colour classes of a menu group, from the `icon` and `tone`
// names its catalog entry gives (keybindings/menuGroups.js).
import {
  ArrowDownUp,
  BookOpenCheck,
  Copy,
  Crosshair,
  Eye,
  FileCode,
  FolderOpen,
  GitCompare,
  Globe,
  Hand,
  ListFilter,
  ListTree,
  Navigation,
  Palette,
  Play,
  Rocket,
  Send,
} from "lucide-svelte";

const ICONS = {
  ArrowDownUp,
  BookOpenCheck,
  Copy,
  Crosshair,
  Eye,
  FileCode,
  FolderOpen,
  GitCompare,
  Globe,
  Hand,
  ListFilter,
  ListTree,
  Navigation,
  Palette,
  Play,
  Rocket,
  Send,
};

// Full class strings, so Tailwind keeps them. `tile` backs a group's icon,
// `chip` its count and search tag, `bar` marks the highlighted row.
const TONES = {
  sky: { tile: "bg-sky-500/15 text-sky-600 dark:text-sky-300", chip: "bg-sky-500/15 text-sky-700 dark:text-sky-200", bar: "bg-sky-500" },
  violet: { tile: "bg-violet-500/15 text-violet-600 dark:text-violet-300", chip: "bg-violet-500/15 text-violet-700 dark:text-violet-200", bar: "bg-violet-500" },
  emerald: { tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200", bar: "bg-emerald-500" },
  amber: { tile: "bg-amber-500/15 text-amber-600 dark:text-amber-300", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-200", bar: "bg-amber-500" },
  rose: { tile: "bg-rose-500/15 text-rose-600 dark:text-rose-300", chip: "bg-rose-500/15 text-rose-700 dark:text-rose-200", bar: "bg-rose-500" },
  indigo: { tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300", chip: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200", bar: "bg-indigo-500" },
  teal: { tile: "bg-teal-500/15 text-teal-600 dark:text-teal-300", chip: "bg-teal-500/15 text-teal-700 dark:text-teal-200", bar: "bg-teal-500" },
  fuchsia: { tile: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300", chip: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-200", bar: "bg-fuchsia-500" },
  orange: { tile: "bg-orange-500/15 text-orange-600 dark:text-orange-300", chip: "bg-orange-500/15 text-orange-700 dark:text-orange-200", bar: "bg-orange-500" },
};

// A row outside any group.
export const NEUTRAL_TONE = {
  tile: "bg-surface-500/15 text-surface-700 dark:text-surface-200",
  chip: "bg-surface-500/15",
  bar: "bg-surface-500",
};

export function groupIcon(group) {
  return ICONS[group?.icon] ?? null;
}

export function groupTone(group) {
  return TONES[group?.tone] ?? NEUTRAL_TONE;
}
