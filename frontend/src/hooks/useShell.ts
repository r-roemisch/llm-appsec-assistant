import { createContext, useContext } from "react";

export interface ShellState {
  /** Desktop sidebar hidden (persisted). */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Phone-width sidebar shown as an overlay. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used inside AppShell");
  return shell;
}
