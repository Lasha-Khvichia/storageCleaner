/**
 * Internationalisation.
 *
 * - Every UI string lives in a dictionary (`en.ts` is the source of truth;
 *   other languages are typed `Record<keyof typeof en, string>`, so a missing
 *   key is a compile error).
 * - `t("key", { name: value })` fills `{name}` placeholders.
 * - `tn("key", n)` picks `key.one` / `key.other` for counts.
 * - Components call `useT()` (see `useT.ts`) so they re-render on switch.
 *
 * To add a language: create `xx.ts` like `ka.ts`, add it to DICTS and
 * LANGUAGES below (and `backend.ts` for texts that come from the Rust core).
 */
import { en, type MessageKey } from "./en";
import { ka } from "./ka";

export type Lang = "en" | "ka";
export type { MessageKey };

export interface LanguageInfo {
  id: Lang;
  /** Name in English. */
  name: string;
  /** Name in the language itself (shown in the switcher). */
  native: string;
  /** Short label for the compact top-bar toggle. */
  short: string;
  /** BCP-47 locale for dates and numbers. */
  locale: string;
}

export const LANGUAGES: LanguageInfo[] = [
  { id: "en", name: "English", native: "English", short: "EN", locale: "en-US" },
  { id: "ka", name: "Georgian", native: "ქართული", short: "ქა", locale: "ka-GE" },
];

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ka };

const KEY = "storageCleaner.lang";
let current: Lang = "en";

export function storedLang(): Lang {
  const v = localStorage.getItem(KEY);
  return LANGUAGES.some((l) => l.id === v) ? (v as Lang) : "en";
}

/** Switch language globally (call through the store's `setLang`). */
export function applyLang(lang: Lang) {
  current = lang;
  localStorage.setItem(KEY, lang);
  document.documentElement.lang = lang;
}

export function currentLang(): Lang {
  return current;
}

export function locale(): string {
  return LANGUAGES.find((l) => l.id === current)?.locale ?? "en-US";
}

type Params = Record<string, string | number>;

function fill(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Translate a key for the active language (falls back to English). */
export function t(key: MessageKey, params?: Params): string {
  return fill(DICTS[current][key] ?? en[key] ?? key, params);
}

/** Count-aware translate: uses `key.one` for 1, otherwise `key.other`. `{n}` is filled in. */
export function tn(key: string, n: number, params?: Params): string {
  const k = `${key}.${n === 1 ? "one" : "other"}` as MessageKey;
  return t(k, { n: n.toLocaleString(locale()), ...params });
}
