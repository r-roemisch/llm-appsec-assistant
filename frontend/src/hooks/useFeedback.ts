import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  ApiError,
  createEvaluationCase,
  deleteFeedback,
  errorMessage,
  getFeedbackDashboard,
  setFeedback,
  type FeedbackFilters,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ConversationDetailOut, EvaluationCaseIn, FeedbackIn, FeedbackOut, MessageOut } from "@/lib/types";

/** The cached Feedback of one answer. */
function readFeedback(queryClient: QueryClient, conversationId: string, messageId: string): FeedbackOut | null {
  const detail = queryClient.getQueryData<ConversationDetailOut>(queryKeys.conversation(conversationId));
  return detail?.messages.find((message) => message.id === messageId)?.feedback ?? null;
}

/** Puts one answer's Feedback in the cached Conversation, so the message list shows it. */
function writeFeedback(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  feedback: FeedbackOut | null,
): void {
  queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(conversationId), (old) =>
    old
      ? { ...old, messages: old.messages.map((message) => (message.id === messageId ? { ...message, feedback } : message)) }
      : old,
  );
}

/**
 * Rates one of the caller's answers: a FeedbackIn sets or changes the Feedback
 * (PUT), null removes it (DELETE). The thumb shows the new state at once and
 * goes back, with a toast, when the server refuses.
 */
export function useRateAnswer(message: Pick<MessageOut, "id" | "conversation_id">) {
  const queryClient = useQueryClient();
  const { id: messageId, conversation_id: conversationId } = message;
  return useMutation({
    mutationFn: async (input: FeedbackIn | null): Promise<FeedbackOut | null> => {
      if (input) return setFeedback(messageId, input);
      await deleteFeedback(messageId);
      return null;
    },
    onMutate: async (input) => {
      // A refetch that started before the click must not bring the old state back.
      await queryClient.cancelQueries({ queryKey: queryKeys.conversation(conversationId) });
      const previous = readFeedback(queryClient, conversationId, messageId);
      const now = new Date().toISOString();
      writeFeedback(
        queryClient,
        conversationId,
        messageId,
        input
          ? { value: input.value, comment: input.comment ?? null, created_at: previous?.created_at ?? now, updated_at: now }
          : null,
      );
      return { previous };
    },
    onSuccess: (saved) => writeFeedback(queryClient, conversationId, messageId, saved),
    onError: (error, _input, context) => {
      if (context) writeFeedback(queryClient, conversationId, messageId, context.previous);
      toast.error(`Your feedback was not saved: ${errorMessage(error)}`);
    },
  });
}

/** The admin Feedback dashboard; the previous list stays on screen while another filter loads. */
export function useFeedbackDashboard(filters: FeedbackFilters) {
  return useQuery({
    queryKey: queryKeys.adminFeedbackList(filters),
    queryFn: () => getFeedbackDashboard(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * Turns an answer with Feedback into an Evaluation Case. Errors are left to the
 * caller, which shows them in the dialog; a 409 (already converted) also
 * reloads the dashboard, which then shows the case.
 */
export function useCreateEvaluationCase(feedbackId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EvaluationCaseIn) => createEvaluationCase(feedbackId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminFeedback });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminEvaluationCases });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminEvalDatasets });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminFeedback });
      }
    },
  });
}
