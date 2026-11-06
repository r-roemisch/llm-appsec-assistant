// Theme preference: "system", "light" or "dark", persisted in localStorage and
// applied as the `dark` class on <html>. index.html applies the stored value
// before the first paint; this module keeps it in sync afterwards.

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

export const THEME_STORAGE_KEY = "rampart.theme";

type Listener = () => void;
const listeners = new Set<Listener>();

const media =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return media?.matches ? "dark" : "light";
  return preference;
}

let state: ThemeState = { preference: readPreference(), resolved: resolve(readPreference()) };

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Writes the resolved theme to <html>. Safe to call before React mounts. */
export function applyTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", state.resolved === "dark");
  root.style.colorScheme = state.resolved;
}

export function getThemeState(): ThemeState {
  return state;
}

export function setThemePreference(preference: ThemePreference): void {
  state = { preference, resolved: resolve(preference) };
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private mode, blocked); the theme still applies.
  }
  applyTheme();
  notify();
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

media?.addEventListener("change", () => {
  if (state.preference !== "system") return;
  state = { preference: "system", resolved: resolve("system") };
  applyTheme();
  notify();
});
