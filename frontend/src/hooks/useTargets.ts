import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createTarget, deleteTarget, listTargets, updateTarget } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { TargetCreateIn, TargetOut, TargetUpdateIn } from "@/lib/types";

/** The caller's own Targets, newest first. */
export function useTargets() {
  return useQuery({ queryKey: queryKeys.targetList, queryFn: listTargets });
}

/** Registers a Target. Errors are left to the caller, which shows the server's detail. */
export function useCreateTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TargetCreateIn) => createTarget(input),
    onSuccess: (created) => {
      queryClient.setQueryData<TargetOut[]>(queryKeys.targetList, (old) => (old ? [created, ...old] : [created]));
      toast.success(`${created.name} registered`);
    },
  });
}

/** Renames a Target or sets/clears its profile. Errors are left to the caller. */
export function useUpdateTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TargetUpdateIn }) => updateTarget(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<TargetOut[]>(queryKeys.targetList, (old) =>
        old?.map((target) => (target.id === updated.id ? updated : target)),
      );
      toast.success(`${updated.name} updated`);
    },
  });
}

/** Deletes a Target and refreshes the Profile, which may reference it. Errors are left to the caller. */
export function useDeleteTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: TargetOut) => deleteTarget(target.id),
    onSuccess: (_result, target) => {
      queryClient.setQueryData<TargetOut[]>(queryKeys.targetList, (old) =>
        old?.filter((item) => item.id !== target.id),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      toast.success(`${target.name} deleted`);
    },
  });
}
