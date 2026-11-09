import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAdminSettings,
  listAdminTools,
  listApprovals,
  updateAdminSettings,
  updateTool,
  type ApprovalFilters,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { AdminSettingsOut, AdminSettingsPatch, ToolOut, ToolPolicyPatch } from "@/lib/types";

/** Every Tool with its effective policy. */
export function useAdminTools() {
  return useQuery({ queryKey: queryKeys.adminTools, queryFn: listAdminTools });
}

/** Saves one Tool's policy. Errors are left to the caller, which shows the server's detail. */
export function useUpdateTool(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ToolPolicyPatch) => updateTool(name, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<ToolOut[]>(queryKeys.adminTools, (old) =>
        old?.map((tool) => (tool.name === updated.name ? updated : tool)),
      );
      // What users' turns may call changed too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
    },
  });
}

export const PENDING_ADMIN_APPROVALS: ApprovalFilters = { status: "pending", approver: "admin" };

/** Approvals that wait for an administrator; new ones arrive while the page is open. */
export function usePendingAdminApprovals() {
  return useQuery({
    queryKey: queryKeys.adminApprovalList(PENDING_ADMIN_APPROVALS),
    queryFn: () => listApprovals(PENDING_ADMIN_APPROVALS),
    refetchInterval: 60_000,
  });
}

export function useAdminSettings() {
  return useQuery({ queryKey: queryKeys.adminSettings, queryFn: getAdminSettings });
}

/** Saves any subset of the settings. Errors are left to the caller. */
export function useUpdateAdminSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AdminSettingsPatch) => updateAdminSettings(patch),
    onSuccess: (updated) => queryClient.setQueryData<AdminSettingsOut>(queryKeys.adminSettings, updated),
  });
}
