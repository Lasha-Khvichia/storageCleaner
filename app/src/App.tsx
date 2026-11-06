import { useEffect } from "react";
import { api, events } from "./api";
import { DeleteModal } from "./components/DeleteModal";
import { PermanentBanner, SelectionTray, Sidebar, Toasts } from "./components/Layout";
import { TitleBar } from "./components/TitleBar";
import { Dashboard } from "./pages/Dashboard";
import { Explorer } from "./pages/Explorer";
import { Files } from "./pages/Files";
import { HistoryPage } from "./pages/History";
import { Settings } from "./pages/Settings";
import { Recommended } from "./pages/Recommended";
import { Suggestions } from "./pages/Suggestions";
import { formatBytes, formatDuration } from "./lib/format";
import { t } from "./i18n";
import { trBackend } from "./i18n/backend";
import { useStore } from "./store";

function useScanEvents() {
  useEffect(() => {
    const store = useStore.getState;
    // Pick up a scan that already finished (e.g. after a UI reload).
    api.getScanInfo().then((info) => info && store().setScan({ info }));

    const subs = [
      events.onScanProgress((progress) => store().setScan({ progress })),
      events.onScanFinished((info) => {
        store().setScan({ running: false, info, error: null });
        store().setCurrentDir(0);
        store().bumpData();
        if (info)
          store().pushToast({
            kind: "success",
            title: t("scan.complete"),
            body: t("scan.completeBody", { path: info.root.path, size: formatBytes(info.root.size), duration: formatDuration(info.durationMs) }),
          });
      }),
      events.onScanFailed((f) => {
        store().setScan({ running: false, error: f.cancelled ? null : f.message });
        store().pushToast(
          f.cancelled
            ? { kind: "info", title: t("scan.cancelled") }
            : { kind: "error", title: t("scan.failed"), body: trBackend(f.message) },
        );
      }),
    ];
    return () => {
      subs.forEach((p) => p.then((un) => un()));
    };
  }, []);
}

export default function App() {
  useScanEvents();
  const page = useStore((s) => s.page);
  // Keyed by language: switching remounts the UI so every string, chart and
  // formatted date updates at once (app state lives in the store, so nothing is lost).
  const lang = useStore((s) => s.lang);
  return (
    <div key={lang} className="flex h-full">
      <div data-tauri-drag-region className="flex p-3 pr-0">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />
        <PermanentBanner />
        <main className="min-h-0 flex-1 overflow-y-auto px-7 pb-28 pt-4">
          {page === "dashboard" && <Dashboard />}
          {page === "explorer" && <Explorer />}
          {page === "recommended" && <Recommended />}
          {page === "suggestions" && <Suggestions />}
          {page === "files" && <Files />}
          {page === "history" && <HistoryPage />}
          {page === "settings" && <Settings />}
        </main>
      </div>
      <SelectionTray />
      <DeleteModal />
      <Toasts />
    </div>
  );
}
