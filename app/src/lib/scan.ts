import { api, errorMessage } from "../api";
import { useStore } from "../store";

/** Start a scan and switch to the explorer. `usedBytes` enables a % estimate. */
export async function startScan(path: string, usedBytes: number | null) {
  const s = useStore.getState();
  if (s.scan.running) {
    s.pushToast({ kind: "info", title: "A scan is already running" });
    return;
  }
  // Node ids from the previous scan become invalid.
  s.clearSelection();
  s.setCurrentDir(0);
  s.setScan({ running: true, target: path, targetUsedBytes: usedBytes, progress: null, error: null });
  s.setPage("explorer");
  try {
    await api.startScan(path);
  } catch (e) {
    useStore.getState().setScan({ running: false, error: errorMessage(e) });
  }
}
