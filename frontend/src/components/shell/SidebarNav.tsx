import { FileTextIcon, IdCardIcon, LibraryBigIcon, LifeBuoyIcon, TargetIcon } from "lucide-react";
import { NavLink } from "react-router";

import { cn } from "@/lib/utils";

const PAGES = [
  { to: "/knowledge", label: "Knowledge Base", Icon: LibraryBigIcon },
  { to: "/profile", label: "Project Profile", Icon: IdCardIcon },
  { to: "/targets", label: "Targets", Icon: TargetIcon },
  { to: "/reports", label: "Reports", Icon: FileTextIcon },
  { to: "/help", label: "Help", Icon: LifeBuoyIcon },
] as const;

/** Links to the pages beside the Conversations. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Pages" className="px-2 pb-2">
      <ul className="flex flex-col gap-0.5">
        {PAGES.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50",
                  isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent",
                )
              }
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
