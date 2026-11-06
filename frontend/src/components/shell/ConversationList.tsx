import { ConversationListItem } from "@/components/shell/ConversationListItem";
import { useConversationList } from "@/hooks/useConversations";
import { useNow } from "@/hooks/useNow";

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isPending, isError, refetch } = useConversationList();
  const now = useNow();

  if (isPending) {
    return (
      <div className="flex flex-col gap-2 px-4 py-2" aria-busy="true" aria-label="Loading conversations">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-9 animate-pulse rounded-md bg-sidebar-accent/70" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Could not load Conversations.{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void refetch()}>
          Try again
        </button>
      </p>
    );
  }

  if (data.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">No Conversations yet. Ask something to start one.</p>;
  }

  const ordered = [...data].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-2">
      {ordered.map((conversation) => (
        <ConversationListItem key={conversation.id} conversation={conversation} now={now} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}
