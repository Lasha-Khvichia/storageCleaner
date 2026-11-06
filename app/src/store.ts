import { create } from "zustand";
import type { NodeView, SafetyLevel, ScanInfo, ScanProgress } from "./api";
import { applyTheme, storedTheme } from "./lib/theme";
import { applyLang, storedLang, type Lang } from "./i18n";

export type Page = "dashboard" | "explorer" | "recommended" | "suggestions" | "files" | "history" | "settings";

/** What we keep about a selected node (ids are only valid for the current scan). */
export interface SelectedItem {
  id: number;
  name: string;
  path: string;
  size: number;
  safety: SafetyLevel;
  kind: string;
}

export function toSelected(n: NodeView): SelectedItem {
  return { id: n.id, name: n.name, path: n.path, size: n.size, safety: n.safety, kind: n.kind };
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
}

const PERMANENT_KEY = "storageCleaner.permanentDelete";

interface ScanState {
  running: boolean;
  target: string | null;
  /** Used bytes of the drive being scanned, for a % estimate. */
  targetUsedBytes: number | null;
  progress: ScanProgress | null;
  info: ScanInfo | null;
  error: string | null;
}

interface AppStore {
  page: Page;
  setPage: (p: Page) => void;

  /** Active theme id (see lib/theme.ts). */
  theme: string;
  setTheme: (id: string) => void;

  /** Active UI language (see i18n/index.ts). */
  lang: Lang;
  setLang: (lang: Lang) => void;

  /** Node currently shown in the explorer. */
  currentDir: number;
  setCurrentDir: (id: number) => void;

  scan: ScanState;
  setScan: (patch: Partial<ScanState>) => void;

  permanentDelete: boolean;
  setPermanentDelete: (on: boolean) => void;

  selection: Map<number, SelectedItem>;
  toggleSelect: (item: SelectedItem) => void;
  selectMany: (items: SelectedItem[], selected: boolean) => void;
  clearSelection: () => void;

  /** Bumped after deletes/restores so views refetch. */
  dataVersion: number;
  bumpData: () => void;

  deleteModalOpen: boolean;
  setDeleteModalOpen: (open: boolean) => void;

  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useStore = create<AppStore>((set, get) => ({
  page: "dashboard",
  setPage: (page) => set({ page }),

  theme: storedTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  lang: storedLang(),
  setLang: (lang) => {
    applyLang(lang);
    set({ lang });
  },

  currentDir: 0,
  setCurrentDir: (currentDir) => set({ currentDir }),

  scan: { running: false, target: null, targetUsedBytes: null, progress: null, info: null, error: null },
  setScan: (patch) => set({ scan: { ...get().scan, ...patch } }),

  permanentDelete: localStorage.getItem(PERMANENT_KEY) === "1",
  setPermanentDelete: (on) => {
    localStorage.setItem(PERMANENT_KEY, on ? "1" : "0");
    set({ permanentDelete: on });
  },

  selection: new Map(),
  toggleSelect: (item) => {
    if (item.safety === "protected") return;
    const next = new Map(get().selection);
    if (next.has(item.id)) next.delete(item.id);
    else next.set(item.id, item);
    set({ selection: next });
  },
  selectMany: (items, selected) => {
    const next = new Map(get().selection);
    for (const it of items) {
      if (it.safety === "protected") continue;
      if (selected) next.set(it.id, it);
      else next.delete(it.id);
    }
    set({ selection: next });
  },
  clearSelection: () => set({ selection: new Map() }),

  dataVersion: 0,
  bumpData: () => set({ dataVersion: get().dataVersion + 1 }),

  deleteModalOpen: false,
  setDeleteModalOpen: (deleteModalOpen) => set({ deleteModalOpen }),

  toasts: [],
  pushToast: (t) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.kind === "error" ? 12000 : 7000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
