import { useQuery } from "@tanstack/react-query";

import { getHealth } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-muted-foreground/40")}
      />
      {label}
    </span>
  );
}

/** Version and provider status from GET /api/health, for the login page. */
export function HealthFooter() {
  const { data, isError } = useQuery({
    queryKey: queryKeys.health,
    queryFn: getHealth,
    staleTime: 60_000,
    retry: false,
  });

  if (isError) {
    return <p className="text-xs text-muted-foreground">The server is not responding.</p>;
  }
  if (!data) return null;

  return (
    <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>Rampart {data.version}</span>
      <Status
        ok={data.providers.openrouter}
        label={data.providers.openrouter ? "OpenRouter configured" : "OpenRouter not configured"}
      />
      <Status ok={data.providers.ollama} label={data.providers.ollama ? "Ollama reachable" : "Ollama unreachable"} />
      <span>Tracing to {data.tracing === "langfuse" ? "Langfuse" : "JSONL files"}</span>
    </p>
  );
}
