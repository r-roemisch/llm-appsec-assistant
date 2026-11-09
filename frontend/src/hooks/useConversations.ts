import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  createConversation,
  deleteConversation,
  errorMessage,
  getConversation,
  listConversations,
  updateConversation,
} from "@/lib/api";
import { discardTurn, startTurn } from "@/lib/live-turn";
import { queryKeys } from "@/lib/query-keys";
import type { ConversationDetailOut, ConversationOut, ConversationPatch } from "@/lib/types";

export function useConversationList() {
  return useQuery({ queryKey: queryKeys.conversationList, queryFn: listConversations });
}

/** How often to look for an administrator's decision while a turn waits for one. */
const ADMIN_DECISION_POLL_MS = 30_000;

function waitsForAdmin(detail: ConversationDetailOut | undefined): boolean {
  return Boolean(
    detail?.messages.some(
      (message) =>
        message.status === "awaiting_approval" &&
        message.pending_approval?.approver === "admin" &&
        message.pending_approval.status === "pending",
    ),
  );
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.conversation(id ?? ""),
    queryFn: id ? () => getConversation(id) : skipToken,
    // An administrator decides elsewhere; poll so "Continue" appears without a reload.
    refetchInterval: (query) => (waitsForAdmin(query.state.data) ? ADMIN_DECISION_POLL_MS : false),
  });
}

export interface StartConversationInput {
  /** The first user message. */
  content: string;
  /** The chat Model; the server's chat Slot when absent. */
  modelId?: string | null;
  helpMode?: boolean;
}

/**
 * Creates a Conversation, opens it at /c/:id and sends its first message: the
 * flow behind the composer on "/" and the help page's question box. Failures
 * are shown as a toast; callers can add their own handling per call.
 */
export function useStartConversation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: ({ modelId, helpMode }: StartConversationInput) =>
      createConversation({
        ...(modelId ? { model_id: modelId } : {}),
        ...(helpMode ? { help_mode: true } : {}),
      }),
    onSuccess: (created, { content }) => {
      queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(created.id), {
        conversation: created,
        messages: [],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
      navigate(`/c/${created.id}`);
      void startTurn(queryClient, created.id, content);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

function mergeConversation(queryClient: QueryClient, updated: ConversationOut) {
  queryClient.setQueryData<ConversationOut[]>(queryKeys.conversationList, (old) =>
    old?.map((item) => (item.id === updated.id ? updated : item)),
  );
  queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(updated.id), (old) =>
    old ? { ...old, conversation: updated } : old,
  );
}

/** Applies `patch` to the cached Conversation at once; returns the copy to roll back to. */
async function patchOptimistically(queryClient: QueryClient, id: string, patch: ConversationPatch) {
  const key = queryKeys.conversation(id);
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<ConversationDetailOut>(key);
  queryClient.setQueryData<ConversationDetailOut>(key, (old) =>
    old ? { ...old, conversation: { ...old.conversation, ...patch } } : old,
  );
  return { previous };
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateConversation(id, { title }),
    onSuccess: (updated) => mergeConversation(queryClient, updated),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useSetConversationModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, modelId }: { id: string; modelId: string }) => updateConversation(id, { model_id: modelId }),
    onMutate: ({ id, modelId }) => patchOptimistically(queryClient, id, { model_id: modelId }),
    onSuccess: (updated) => mergeConversation(queryClient, updated),
    onError: (error, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.conversation(id), context.previous);
      toast.error(errorMessage(error));
    },
  });
}

/** Turns help mode on or off for the next turns of one Conversation. */
export function useSetConversationHelpMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, helpMode }: { id: string; helpMode: boolean }) =>
      updateConversation(id, { help_mode: helpMode }),
    onMutate: ({ id, helpMode }) => patchOptimistically(queryClient, id, { help_mode: helpMode }),
    onSuccess: (updated) => mergeConversation(queryClient, updated),
    onError: (error, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.conversation(id), context.previous);
      toast.error(errorMessage(error));
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_result, id) => {
      discardTurn(id);
      queryClient.setQueryData<ConversationOut[]>(queryKeys.conversationList, (old) =>
        old?.filter((item) => item.id !== id),
      );
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
