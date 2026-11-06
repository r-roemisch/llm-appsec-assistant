import { useSyncExternalStore } from "react";

import { getThemeState, setThemePreference, subscribeTheme, type ThemeState } from "@/lib/theme";

export function useTheme(): ThemeState & { setPreference: typeof setThemePreference } {
  const state = useSyncExternalStore(subscribeTheme, getThemeState, getThemeState);
  return { ...state, setPreference: setThemePreference };
}
