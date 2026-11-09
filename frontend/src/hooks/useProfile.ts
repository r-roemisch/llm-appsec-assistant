import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { deleteProfile, getProfile, importDependencyFile, previewDependencyFile, saveProfile } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { DependencyFileIn, DependencyImportIn, ProfileIn, ProfileOut } from "@/lib/types";

export function useProfile() {
  return useQuery({ queryKey: queryKeys.profile, queryFn: getProfile });
}

/** Saves the profile. Errors are left to the caller, which shows the server's detail. */
export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileIn) => saveProfile(input),
    onSuccess: (saved) => {
      queryClient.setQueryData<ProfileOut>(queryKeys.profile, saved);
      toast.success("Project Profile saved");
    },
  });
}

/** Deletes the profile; the next turn no longer gets it. Errors are left to the caller. */
export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      queryClient.setQueryData<ProfileOut>(queryKeys.profile, (old) =>
        old ? { ...old, exists: false, stack: "", packages: [], target_ids: [], updated_at: null } : old,
      );
      toast.success("Project Profile deleted");
    },
  });
}

/** (M7) Reads a Dependency File for review; nothing is saved. Errors are left to the caller. */
export function usePreviewDependencyFile() {
  return useMutation({ mutationFn: (input: DependencyFileIn) => previewDependencyFile(input) });
}

/** (M7) Imports a Dependency File into the profile. Errors are left to the caller. */
export function useImportDependencyFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DependencyImportIn) => importDependencyFile(input),
    onSuccess: (saved) => {
      queryClient.setQueryData<ProfileOut>(queryKeys.profile, saved);
      toast.success(`Project Profile now lists ${saved.packages.length} packages`);
    },
  });
}
