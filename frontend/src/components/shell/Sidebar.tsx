import { PanelLeftCloseIcon, PlusIcon } from "lucide-react";
import { Link } from "react-router";

import { Brand } from "@/components/common/Brand";
import { ConversationList } from "@/components/shell/ConversationList";
import { SidebarNav } from "@/components/shell/SidebarNav";
import { UserMenu } from "@/components/shell/UserMenu";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useShell } from "@/hooks/useShell";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { toggleCollapsed } = useShell();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
        <Brand />
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden text-muted-foreground md:inline-flex"
          onClick={toggleCollapsed}
          aria-label="Hide sidebar"
        >
          <PanelLeftCloseIcon />
        </Button>
      </div>
      <div className="px-3 pb-3">
        <Button asChild variant="outline" className="w-full justify-start">
          <Link to="/" onClick={onNavigate}>
            <PlusIcon />
            New conversation
          </Link>
        </Button>
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <h2 className="shrink-0 border-t px-4 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">Conversations</h2>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <ConversationList onNavigate={onNavigate} />
      </ScrollArea>
      <div className="shrink-0 border-t p-2">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}
