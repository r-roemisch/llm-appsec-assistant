import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { acceptPlugin, ApiError, getPlugin, listPlugins, refreshPlugin, setPluginEnabled } from "@/lib/api";
import { summaryOf } from "@/lib/plugins";
import { queryKeys } from "@/lib/query-keys";
import type { PluginCatalogOut, PluginDetailOut } from "@/lib/types";

/** The Plugin catalog with each Plugin's state (M5). */
export function usePlugins() {
  return useQuery({ queryKey: queryKeys.adminPluginList, queryFn: listPlugins });
}

/** One Plugin with its current and accepted definitions and the changes between them. */
export function usePlugin(id: string) {
  return useQuery({ queryKey: queryKeys.adminPlugin(id), queryFn: () => getPlugin(id) });
}

/** Shows a Plugin's new state in its detail and in the list, and reloads the Tools it contributes. */
function store(queryClient: QueryClient, detail: PluginDetailOut) {
  queryClient.setQueryData<PluginDetailOut>(queryKeys.adminPlugin(detail.id), detail);
  const plugin = summaryOf(detail);
  queryClient.setQueryData<PluginCatalogOut>(queryKeys.adminPluginList, (old) =>
    old ? { ...old, plugins: old.plugins.map((item) => (item.id === plugin.id ? plugin : item)) } : old,
  );
  // Accepting, enabling and drift decide which Plugin Tools exist and whether they are blocked.
  void queryClient.invalidateQueries({ queryKey: queryKeys.adminTools });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
}

/** Enables (which also lists the Tools, about a second) or disables a Plugin. Errors are left to the caller. */
export function useSetPluginEnabled(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setPluginEnabled(id, enabled),
    onSuccess: (detail) => store(queryClient, detail),
    // A refused change (an entry that became invalid, say) means the list is out of date.
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminPlugins }),
  });
}

/** Starts the server and lists its Tools again. Errors are left to the caller. */
export function useRefreshPlugin(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshPlugin(id),
    onSuccess: (detail) => store(queryClient, detail),
  });
}

/**
 * Accepts the reviewed definitions by their digest. On 409 (they changed since
 * the review) the detail and the list are fetched again, so the admin reviews
 * what is current; the caller says so.
 */
export function useAcceptPlugin(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (digest: string) => acceptPlugin(id, digest),
    onSuccess: (detail) => store(queryClient, detail),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminPlugins });
      }
    },
  });
}
