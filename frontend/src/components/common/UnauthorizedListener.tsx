import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { queryKeys } from "@/lib/query-keys";
import { onUnauthorized } from "@/lib/session";

/** When any request answers 401, forget the session and go to the login page. */
export function UnauthorizedListener() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.setQueryData(queryKeys.session, null);
        if (window.location.pathname !== "/login") navigate("/login", { replace: true });
      }),
    [navigate, queryClient],
  );

  return null;
}
