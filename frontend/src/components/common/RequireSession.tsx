import { Navigate, Outlet, useLocation } from "react-router";

import { RampartMark } from "@/components/common/Brand";
import { Button } from "@/components/ui/button";
import { SessionContext, useSessionQuery } from "@/hooks/useSession";
import { errorMessage } from "@/lib/api";

/** Layout route: loads the session once and sends signed-out visitors to /login. */
export function RequireSession() {
  const { data, isPending, isError, error, refetch, isFetching } = useSessionQuery();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <RampartMark className="size-5 animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <RampartMark className="size-8" />
        <div>
          <h1 className="text-lg font-semibold">Rampart is not reachable</h1>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
        </div>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <SessionContext value={data}>
      <Outlet />
    </SessionContext>
  );
}
