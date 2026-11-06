import { formatCost, formatLatency, formatTokens } from "@/lib/format";
import { providerLabel } from "@/lib/labels";
import type { Provider } from "@/lib/types";

interface MessageMetaProps {
  modelName: string;
  provider: Provider | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  streaming?: boolean;
}

/** The small line under an answer: Model, tokens, cost, latency. */
export function MessageMeta({
  modelName,
  provider,
  inputTokens,
  outputTokens,
  costUsd,
  latencyMs,
  streaming,
}: MessageMetaProps) {
  const hasTokens = inputTokens !== null || outputTokens !== null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/75">{modelName}</span>
      {provider ? <span>{providerLabel(provider)}</span> : null}
      {hasTokens ? (
        <span className="tabular-nums" title="Input and output tokens">
          {formatTokens(inputTokens)} in, {formatTokens(outputTokens)} out
        </span>
      ) : null}
      {costUsd !== null ? (
        <span className="tabular-nums" title="Cost of this answer">
          {formatCost(costUsd)}
        </span>
      ) : null}
      {latencyMs !== null ? (
        <span className="tabular-nums" title="Time to the full answer">
          {formatLatency(latencyMs)}
        </span>
      ) : null}
      {streaming ? <span>Streaming</span> : null}
    </div>
  );
}
