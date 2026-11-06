import { useStore } from "../store";
import { t, tn } from "./index";

/**
 * Translation hook: subscribes the component to language changes, so it
 * re-renders when the user switches. Returns the `t` / `tn` helpers.
 */
export function useT() {
  const lang = useStore((s) => s.lang);
  return { t, tn, lang };
}
