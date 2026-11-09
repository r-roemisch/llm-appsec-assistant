import { LifeBuoyIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteConversation, useRenameConversation } from "@/hooks/useConversations";
import { formatCost, formatRelativeTime } from "@/lib/format";
import type { ConversationOut } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ConversationListItemProps {
  conversation: ConversationOut;
  now: number;
  onNavigate?: () => void;
}

export function ConversationListItem({ conversation, now, onNavigate }: ConversationListItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === `/c/${conversation.id}`;
  const [renaming, setRenaming] = useState(false);
  const cancelledRename = useRef(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rename = useRenameConversation();
  const remove = useDeleteConversation();
  const title = conversation.title || "Untitled";

  function startRename() {
    cancelledRename.current = false;
    setRenaming(true);
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cancelledRename.current) return;
    const value = new FormData(event.currentTarget).get("title");
    const next = typeof value === "string" ? value.trim() : "";
    if (!next || next === conversation.title) {
      setRenaming(false);
      return;
    }
    rename.mutate({ id: conversation.id, title: next }, { onSettled: () => setRenaming(false) });
  }

  function onRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      cancelledRename.current = true;
      setRenaming(false);
    }
  }

  function confirmDelete() {
    remove.mutate(conversation.id, {
      onSuccess: () => {
        setConfirmingDelete(false);
        if (active) navigate("/");
      },
    });
  }

  return (
    <li
      className={cn(
        "group relative rounded-md",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
      )}
    >
      {renaming ? (
        <form onSubmit={submitRename} className="px-1.5 py-1">
          <input
            name="title"
            defaultValue={conversation.title}
            autoFocus
            aria-label="Conversation title"
            maxLength={200}
            onKeyDown={onRenameKeyDown}
            onBlur={(event) => event.currentTarget.form?.requestSubmit()}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </form>
      ) : (
        <NavLink
          to={`/c/${conversation.id}`}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className="block rounded-md py-2 pr-9 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex items-center gap-1.5">
            {conversation.help_mode ? (
              <LifeBuoyIcon role="img" aria-label="Help mode" className="size-3.5 shrink-0 text-primary" />
            ) : null}
            <span className="truncate text-sm font-medium">{title}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatRelativeTime(conversation.updated_at, now)}</span>
            <span className="rounded-sm border px-1 py-px text-[11px] leading-none tabular-nums">
              {formatCost(conversation.total_cost_usd)}
            </span>
          </span>
        </NavLink>
      )}

      {!renaming ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${title}`}
              className={cn(
                "absolute top-1.5 right-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-open:opacity-100",
                active && "opacity-100",
              )}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40" onCloseAutoFocus={(event) => event.preventDefault()}>
            <DropdownMenuItem onSelect={startRename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this Conversation?"
        description={
          <>
            "{title}" and its messages will be deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </li>
  );
}
