import { Suspense, useCallback, useMemo, useState } from "react";
import { Outlet } from "react-router";

import { Sidebar } from "@/components/shell/Sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ShellContext, type ShellState } from "@/hooks/useShell";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "rampart.sidebar";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Storage unavailable; the choice lasts for this page load only.
  }
}

/** Sidebar plus the page area. Below 768px the sidebar is a sheet. */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    writeCollapsed(next);
    setCollapsed(next);
  }, [collapsed]);

  const shell = useMemo<ShellState>(
    () => ({ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, toggleCollapsed, mobileOpen],
  );

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <ShellContext value={shell}>
      <div className="flex h-dvh w-full overflow-hidden">
        <aside
          className={cn(
            "hidden w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex",
            collapsed && "md:hidden",
          )}
        >
          <Sidebar />
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-[85vw] max-w-xs gap-0 bg-sidebar p-0 text-sidebar-foreground md:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar onNavigate={closeMobile} />
          </SheetContent>
        </Sheet>
        <main className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </ShellContext>
  );
}
