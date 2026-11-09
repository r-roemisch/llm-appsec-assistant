import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiError,
  deleteEvaluationCase,
  estimateEval,
  getEvalDatasets,
  getEvalRun,
  listEvalRuns,
  listEvaluationCases,
  startEvalRuns,
} from "@/lib/api";
import { isActiveRun, runsPollInterval, EVAL_POLL_MS } from "@/lib/eval";
import { queryKeys } from "@/lib/query-keys";
import type { EvalEstimateIn, EvalRunIn } from "@/lib/types";

/** Authored and added cases per suite, and the guard sets. */
export function useEvalDatasets() {
  return useQuery({ queryKey: queryKeys.adminEvalDatasets, queryFn: getEvalDatasets });
}

/** The Evaluation Cases admins added from Feedback. */
export function useEvaluationCases() {
  return useQuery({ queryKey: queryKeys.adminEvaluationCases, queryFn: listEvaluationCases });
}

/** Deletes an added case; its Feedback stays and can be turned into a case again. Errors are left to the caller. */
export function useDeleteEvaluationCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEvaluationCase(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminEvaluationCases });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminEvalDatasets });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminFeedback });
    },
  });
}

/** Asks the server what a run would cost. Errors are left to the caller. */
export function useEvalEstimate() {
  return useMutation({ mutationFn: (input: EvalEstimateIn) => estimateEval(input) });
}

/**
 * Starts the runs the admin confirmed. On success, and on a 409 (the estimate
 * changed, or another run is active), the run list is fetched again. Errors are
 * left to the caller.
 */
export function useStartEvalRuns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalRunIn) => startEvalRuns(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminEvalRuns }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminEvalRuns });
      }
    },
  });
}

/** The runs, newest first, fetched again every few seconds while one is queued or running. */
export function useEvalRuns() {
  return useQuery({
    queryKey: queryKeys.adminEvalRunList,
    queryFn: listEvalRuns,
    refetchInterval: (query) => runsPollInterval(query.state.data),
  });
}

/** One run with its report; polled like the list while it is queued or running. */
export function useEvalRun(id: string) {
  return useQuery({
    queryKey: queryKeys.adminEvalRun(id),
    queryFn: () => getEvalRun(id),
    refetchInterval: (query) => (query.state.data && isActiveRun(query.state.data) ? EVAL_POLL_MS : false),
  });
}
