import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createConversation,
  deleteConversation,
  errorMessage,
  getConversation,
  listConversations,
  updateConversation,
} from "@/lib/api";
import { discardTurn } from "@/lib/live-turn";
import { queryKeys } from "@/lib/query-keys";
import type { ConversationDetailOut, ConversationOut } from "@/lib/types";

export function useConversationList() {
  return useQuery({ queryKey: queryKeys.conversationList, queryFn: listConversations });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.conversation(id ?? ""),
    queryFn: id ? () => getConversation(id) : skipToken,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { model_id?: string; title?: string }) => createConversation(input),
    onSuccess: (created) => {
      queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(created.id), {
        conversation: created,
        messages: [],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });
    },
  });
}

function mergeConversation(queryClient: ReturnType<typeof useQueryClient>, updated: ConversationOut) {
  queryClient.setQueryData<ConversationOut[]>(queryKeys.conversationList, (old) =>
    old?.map((item) => (item.id === updated.id ? updated : item)),
  );
  queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(updated.id), (old) =>
    old ? { ...old, conversation: updated } : old,
  );
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
    onMutate: async ({ id, modelId }) => {
      const key = queryKeys.conversation(id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ConversationDetailOut>(key);
      queryClient.setQueryData<ConversationDetailOut>(key, (old) =>
        old ? { ...old, conversation: { ...old.conversation, model_id: modelId } } : old,
      );
      return { previous };
    },
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
