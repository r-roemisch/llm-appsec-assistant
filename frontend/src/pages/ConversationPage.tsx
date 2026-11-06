import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { LoadError } from "@/components/common/QueryState";
import { Composer } from "@/components/conversation/Composer";
import { MessageList } from "@/components/conversation/MessageList";
import { ModelPicker } from "@/components/conversation/ModelPicker";
import { NewConversationIntro } from "@/components/conversation/NewConversationIntro";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversation, useSetConversationModel } from "@/hooks/useConversations";
import { useLiveTurn } from "@/hooks/useLiveTurn";
import { useModels } from "@/hooks/useModels";
import { ApiError, createConversation, errorMessage } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { startTurn, stopTurn } from "@/lib/live-turn";
import { queryKeys } from "@/lib/query-keys";

/** "/" (a Conversation that does not exist yet) and "/c/:id". */
export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modelsQuery = useModels();
  const detail = useConversation(id);
  const live = useLiveTurn(id);
  const setModel = useSetConversationModel();
  const [draft, setDraft] = useState("");
  const [draftModelId, setDraftModelId] = useState<string | null>(null);

  const models = modelsQuery.data?.models;
  const conversation = detail.data?.conversation;
  const serverMessages = detail.data?.messages;
  // Once `done` put the server copy in the cache, the live turn must not show as well.
  const visibleLive =
    live && !(live.assistantMessageId && serverMessages?.some((message) => message.id === live.assistantMessageId))
      ? live
      : null;
  const selectedModelId = id
    ? (conversation?.model_id ?? null)
    : (draftModelId ?? modelsQuery.data?.slots.chat.model_id ?? null);
  const streaming = live?.status === "streaming";

  function handleModelChange(modelId: string) {
    if (id) setModel.mutate({ id, modelId });
    else setDraftModelId(modelId);
  }

  async function handleSend(content: string) {
    setDraft("");
    if (id) {
      void startTurn(queryClient, id, content);
      return;
    }
    try {
      const created = await createConversation(selectedModelId ? { model_id: selectedModelId } : {});
      queryClient.setQueryData(queryKeys.conversation(created.id), { conversation: created, messages: [] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
      navigate(`/c/${created.id}`);
      void startTurn(queryClient, created.id, content);
    } catch (err) {
      setDraft(content);
      toast.error(errorMessage(err));
    }
  }

  const title = id ? (conversation?.title ?? (detail.isPending ? "" : "Conversation")) : "New conversation";
  const notFound = detail.isError && detail.error instanceof ApiError && detail.error.status === 404;

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
          />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NewConversationIntro onPick={setDraft} />
        </div>
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={(content) => void handleSend(content)}
        onStop={() => {
          if (id) stopTurn(id);
        }}
        streaming={streaming}
        disabled={Boolean(id) && detail.isError}
        autoFocus
        modelPicker={
          <ModelPicker
            models={models ?? []}
            value={selectedModelId}
            onChange={handleModelChange}
            disabled={streaming || setModel.isPending || (Boolean(id) && !conversation)}
          />
        }
      />
    </>
  );
}
