// Shared icon components for Home and the 10 reorderable built-in rail pages,
// kept separate from lib/railOrder.js so pure logic tests load without Svelte.
import {
  BookIcon,
  CompassIcon,
  FlagIcon,
  SendIcon,
  ToolIcon,
  ZapIcon,
} from "svelte-feather-icons";
import {
  BookOpenCheckIcon,
  Brush,
  ChefHat,
  HomeIcon,
  Swords,
} from "lucide-svelte";

export const RAIL_ICONS = Object.freeze({
  home: HomeIcon,
  ledger: BookIcon,
  compass: CompassIcon,
  checkpoint: FlagIcon,
  launchpad: SendIcon,
  armory: Swords,
  logbook: BookOpenCheckIcon,
  workshop: ToolIcon,
  cyberchef: ChefHat,
  excalidraw: Brush,
  interact: ZapIcon,
});
