import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { Crenellation } from "@/components/common/Brand";
import { HealthFooter } from "@/components/common/HealthFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionQuery } from "@/hooks/useSession";
import { ApiError, errorMessage, login } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSessionQuery();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from;
  const target = from && from !== "/login" ? from : "/";

  const signIn = useMutation({
    mutationFn: () => login(username.trim(), password),
    onSuccess: (result) => {
      // Drop anything cached from a previous session before this user's pages mount.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "session" && query.queryKey[0] !== "health",
      });
      queryClient.setQueryData(queryKeys.session, result);
      navigate(target, { replace: true });
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many failed sign-ins. Wait a few minutes, then try again."
          : errorMessage(err),
      ),
  });

  if (session.data) return <Navigate to={target} replace />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    signIn.mutate();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col gap-5">
            <Crenellation />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Rampart</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Security review for LLM applications. Sign in to continue.
              </p>
            </div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={signIn.isPending}>
              {signIn.isPending ? "Signing in" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-xs text-muted-foreground">
            Accounts are created by an admin; there is no sign-up.
          </p>
        </div>
      </main>
      <footer className="px-4 py-5">
        <HealthFooter />
      </footer>
    </div>
  );
}
