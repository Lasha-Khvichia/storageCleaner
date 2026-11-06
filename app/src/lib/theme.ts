import { t } from "../i18n";

/**
 * Theme registry. Each id must have a matching `[data-theme="id"]` block in
 * index.css defining the `--sc-*` tokens. See docs/DESIGN_SYSTEM.md.
 */
export interface ThemeInfo {
  id: string;
  /** Localised (from i18n `theme.<id>.name`). */
  readonly name: string;
  /** Localised (from i18n `theme.<id>.desc`). */
  readonly description: string;
  /** Preview swatches: background, surface, accent, positive. */
  swatches: [string, string, string, string];
}

export const THEMES: ThemeInfo[] = [
  {
    id: "ember",
    get name() {
      return t("theme.ember.name");
    },
    get description() {
      return t("theme.ember.desc");
    },
    swatches: ["#0c0907", "#201813", "#ff7a2f", "#6ee7b7"],
  },
  {
    id: "midnight",
    get name() {
      return t("theme.midnight.name");
    },
    get description() {
      return t("theme.midnight.desc");
    },
    swatches: ["#0b0f17", "#182032", "#6366f1", "#22d3ee"],
  },
  {
    id: "forest",
    get name() {
      return t("theme.forest.name");
    },
    get description() {
      return t("theme.forest.desc");
    },
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
