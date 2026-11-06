/**
 * Theme registry. Each id must have a matching `[data-theme="id"]` block in
 * index.css defining the `--sc-*` tokens. See docs/DESIGN_SYSTEM.md.
 */
export interface ThemeInfo {
  id: string;
  name: string;
  description: string;
  /** Preview swatches: background, surface, accent, positive. */
  swatches: [string, string, string, string];
}

export const THEMES: ThemeInfo[] = [
  {
    id: "ember",
    name: "Ember",
    description: "Warm dark with orange accents and mint highlights.",
    swatches: ["#0c0907", "#201813", "#ff7a2f", "#6ee7b7"],
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Cool navy with indigo accents and cyan highlights.",
    swatches: ["#0b0f17", "#182032", "#6366f1", "#22d3ee"],
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep green-black with emerald accents and amber highlights.",
    swatches: ["#070b09", "#152019", "#10b981", "#facc15"],
  },
];

export const DEFAULT_THEME = "ember";
const KEY = "storageCleaner.theme";

export function storedTheme(): string {
  const t = localStorage.getItem(KEY);
  return THEMES.some((x) => x.id === t) ? (t as string) : DEFAULT_THEME;
}

/** Switch the whole UI: every colour is a CSS variable keyed off data-theme. */
export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
  localStorage.setItem(KEY, id);
}

/** Read a theme token (e.g. "--sc-chart-1") from the active theme. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
