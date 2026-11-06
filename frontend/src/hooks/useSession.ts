import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { ApiError, getMe } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SessionOut, UserOut } from "@/lib/types";

/** The session, or null when the server says there is none. */
async function fetchSession(): Promise<SessionOut | null> {
  try {
    return await getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Loads GET /api/auth/me once per app load. `data` is null when signed out. */
export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export const SessionContext = createContext<SessionOut | null>(null);

/** The signed-in user. Only valid below RequireSession. */
export function useCurrentUser(): UserOut {
  const current = useContext(SessionContext);
  if (!current) throw new Error("useCurrentUser must be used inside RequireSession");
  return current.user;
}
