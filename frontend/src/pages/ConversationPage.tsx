import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";

import { LoadError } from "@/components/common/QueryState";
import { WaitingForDecisionNotice } from "@/components/conversation/ApprovalCard";
import { Composer } from "@/components/conversation/Composer";
import { HelpModeNotice, HelpModeToggle } from "@/components/conversation/HelpMode";
import { MessageList } from "@/components/conversation/MessageList";
import { ModelPicker } from "@/components/conversation/ModelPicker";
import { NewConversationIntro } from "@/components/conversation/NewConversationIntro";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useConversation,
  useSetConversationHelpMode,
  useSetConversationModel,
  useStartConversation,
} from "@/hooks/useConversations";
import { useLiveTurn } from "@/hooks/useLiveTurn";
import { useModels } from "@/hooks/useModels";
import { useCurrentUser } from "@/hooks/useSession";
import { ApiError } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { startTurn, stopTurn, visibleLiveTurn } from "@/lib/live-turn";

/** "/" (a Conversation that does not exist yet) and "/c/:id". */
export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const modelsQuery = useModels();
  const detail = useConversation(id);
  const live = useLiveTurn(id);
  const setModel = useSetConversationModel();
  const setHelpMode = useSetConversationHelpMode();
  const startConversation = useStartConversation();
  // A new conversation can arrive with a message already drafted, e.g. from a
  // Target's "Run a test" button (navigate("/", { state: { draft } })).
  const [draft, setDraft] = useState<string>(() => {
    const state = location.state as { draft?: unknown } | null;
    return typeof state?.draft === "string" ? state.draft : "";
  });
  const [draftModelId, setDraftModelId] = useState<string | null>(null);
  const [draftHelpMode, setDraftHelpMode] = useState(false);

  const models = modelsQuery.data?.models;
  const conversation = detail.data?.conversation;
  const serverMessages = detail.data?.messages;
  // Once the final event put the server copy in the cache, the live turn must not show as well.
  const visibleLive = visibleLiveTurn(live, serverMessages);
  const selectedModelId = id
    ? (conversation?.model_id ?? null)
    : (draftModelId ?? modelsQuery.data?.slots.chat.model_id ?? null);
  const helpMode = id ? (conversation?.help_mode ?? false) : draftHelpMode;
  const streaming = live?.status === "streaming";
  // The server refuses new messages (409) while a turn waits for an Approval decision.
  const waiting = !streaming && Boolean(serverMessages?.some((message) => message.status === "awaiting_approval"));

  function handleModelChange(modelId: string) {
    if (id) setModel.mutate({ id, modelId });
    else setDraftModelId(modelId);
  }

  function handleHelpModeChange(next: boolean) {
    if (id) setHelpMode.mutate({ id, helpMode: next });
    else setDraftHelpMode(next);
  }

  function handleSend(content: string) {
    setDraft("");
    if (id) {
      void startTurn(queryClient, id, content);
      return;
    }
    startConversation.mutate(
      { content, modelId: selectedModelId, helpMode: draftHelpMode },
      {
        // The next new Conversation starts as a normal one again.
        onSuccess: () => setDraftHelpMode(false),
        onError: () => setDraft(content),
      },
    );
  }

  const title = id ? (conversation?.title ?? (detail.isPending ? "" : "Conversation")) : "New conversation";
  const notFound = detail.isError && detail.error instanceof ApiError && detail.error.status === 404;
  const loaded = !id || Boolean(conversation);

  return (
    <>
      <PageHeader title={title}>
        {conversation ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-muted-foreground tabular-nums">{formatCost(conversation.total_cost_usd)}</span>
            </TooltipTrigger>
            <TooltipContent>Total cost of this Conversation</TooltipContent>
          </Tooltip>
        ) : null}
      </PageHeader>

      {id ? (
        detail.isPending ? (
          <div className="flex-1" aria-busy="true" />
        ) : detail.isError ? (
          <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
            {notFound ? (
              <div className="space-y-3 text-sm">
                <p className="font-medium">This Conversation does not exist.</p>
                <p className="text-muted-foreground">It may have been deleted, or the link is not yours.</p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/">Start a new conversation</Link>
                </Button>
              </div>
            ) : (
              <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
            )}
          </div>
        ) : (
          <MessageList
            key={id}
            messages={detail.data.messages}
            live={visibleLive}
            models={models}
            fallbackModelId={conversation?.model_id ?? null}
            helpMode={helpMode}
          />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NewConversationIntro username={user.username} helpMode={helpMode} onPick={setDraft} />
        </div>
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onStop={() => {
          if (id) stopTurn(id);
        }}
        streaming={streaming}
        disabled={(Boolean(id) && detail.isError) || startConversation.isPending || waiting}
        autoFocus
        placeholder={
          waiting ? "Waiting for a decision on a tool call" : helpMode ? "Ask how to use Rampart" : undefined
        }
        notice={waiting ? <WaitingForDecisionNotice /> : helpMode ? <HelpModeNotice /> : null}
        modelPicker={
          <ModelPicker
            models={models ?? []}
            value={selectedModelId}
            onChange={handleModelChange}
            disabled={streaming || setModel.isPending || !loaded}
            className="max-w-40 sm:max-w-56"
          />
        }
        controls={
          <HelpModeToggle
            pressed={helpMode}
            onPressedChange={handleHelpModeChange}
            disabled={streaming || setHelpMode.isPending || !loaded}
          />
        }
      />
    </>
  );
}
