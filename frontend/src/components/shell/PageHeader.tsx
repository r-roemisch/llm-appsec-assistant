import { PanelLeftIcon, PanelLeftOpenIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useShell } from "@/hooks/useShell";

/** The bar at the top of every page: sidebar buttons, title, and extras on the right. */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { collapsed, toggleCollapsed, setMobileOpen } = useShell();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-5">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground md:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open sidebar"
      >
        <PanelLeftIcon />
      </Button>
      {collapsed ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden text-muted-foreground md:inline-flex"
          onClick={toggleCollapsed}
          aria-label="Show sidebar"
        >
          <PanelLeftOpenIcon />
        </Button>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium">{title}</h1>
      {children}
    </header>
  );
}
