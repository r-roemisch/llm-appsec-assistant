import { TriangleAlertIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { RampartMark } from "@/components/common/Brand";
import { AnswerFeedback } from "@/components/conversation/AnswerFeedback";
import { ApprovalCard } from "@/components/conversation/ApprovalCard";
import { BlockedLabel, GuardNotices, StopNotices } from "@/components/conversation/GuardNotices";
import { Markdown } from "@/components/conversation/Markdown";
import { MessageMeta } from "@/components/conversation/MessageMeta";
import { PassageDialog } from "@/components/conversation/PassageDialog";
import { RetrievalProgress } from "@/components/conversation/RetrievalProgress";
import { SourcesList } from "@/components/conversation/SourcesList";
import { ToolCallList } from "@/components/conversation/ToolCallCard";
import { CitationContext, type CitationContextValue } from "@/hooks/useCitations";
import { useTurnNotices } from "@/hooks/useLiveTurn";
import { canRate } from "@/lib/feedback";
import { blockedByInputGuard } from "@/lib/guards";
import type { RetrievalStatus } from "@/lib/retrieval";
import type { CitationOut, GuardEventOut, MessageOut, MessageStatus, ToolCallOut, TurnNoticeData } from "@/lib/types";

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
        {content}
      </div>
    </div>
  );
}

const NONE: readonly never[] = [];

interface AssistantMessageProps {
  content: string;
  status: MessageStatus;
  error: string | null;
  citations: CitationOut[];
  /** The Knowledge Base search of a streaming turn, shown until the answer or a Tool call starts. */
  retrieval?: RetrievalStatus | null;
  /** Shown before the text; calls without a result show as running while the turn streams. */
  toolCalls?: readonly ToolCallOut[];
  guardEvents?: readonly GuardEventOut[];
  /** Why Rampart stopped the turn early. */
  notices?: readonly TurnNoticeData[];
  /** The Approval card of a waiting answer, or the decision line of a resumed one. */
  approval?: ReactNode;
  meta: ReactNode;
}

export function AssistantMessage({
  content,
  status,
  error,
  citations,
  retrieval,
  toolCalls = NONE,
  guardEvents = NONE,
  notices = NONE,
  approval,
  meta,
}: AssistantMessageProps) {
  const streaming = status === "streaming";
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const byNumber = useMemo(() => new Map(citations.map((citation) => [citation.n, citation])), [citations]);
  const citationContext = useMemo<CitationContextValue | null>(
    () => (byNumber.size > 0 ? { byNumber, open: setOpenNumber } : null),
    [byNumber],
  );
  const noAnswer = !streaming && toolCalls.length === 0 && status !== "awaiting_approval";

  return (
    <div className="flex gap-3">
      <RampartMark className="mt-1 size-5 opacity-80" />
      <div className="min-w-0 flex-1 space-y-2.5">
        {blockedByInputGuard(guardEvents) ? <BlockedLabel /> : null}
        <ToolCallList calls={toolCalls} live={streaming} />
        {content ? (
          <CitationContext value={citationContext}>
            <Markdown content={content} streaming={streaming} />
          </CitationContext>
        ) : streaming && retrieval && toolCalls.length === 0 ? (
          <RetrievalProgress status={retrieval} />
        ) : streaming ? (
          <p className="streaming-caret text-sm text-muted-foreground" aria-live="polite" aria-label="Waiting for the answer" />
        ) : noAnswer ? (
          <p className="text-sm text-muted-foreground italic">No answer</p>
        ) : null}
        {status === "error" ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error ?? "The answer failed"}</span>
          </div>
        ) : null}
        <StopNotices notices={notices} answer={content} />
        {approval}
        {citations.length > 0 ? <SourcesList citations={citations} onOpen={setOpenNumber} /> : null}
        <GuardNotices events={guardEvents} />
        {meta}
      </div>
      <PassageDialog
        citation={openNumber === null ? null : (byNumber.get(openNumber) ?? null)}
        onClose={() => setOpenNumber(null)}
      />
    </div>
  );
}

function StoredAssistantMessage({ message, modelName }: { message: MessageOut; modelName: string }) {
  const notices = useTurnNotices(message.id);
  const waiting = message.status === "awaiting_approval" && message.pending_approval;
  const meta = (
    <MessageMeta
      modelName={modelName}
      provider={message.provider}
      inputTokens={message.input_tokens}
      outputTokens={message.output_tokens}
      costUsd={message.cost_usd}
      latencyMs={message.latency_ms}
      retrievalMode={message.retrieval_mode ?? null}
      streaming={message.status === "streaming"}
    />
  );
  return (
    <AssistantMessage
      content={message.content}
      status={message.status}
      error={message.error}
      citations={message.citations ?? []}
      toolCalls={message.tool_calls ?? NONE}
      guardEvents={message.guard_events ?? NONE}
      notices={notices}
      approval={waiting ? <ApprovalCard approval={waiting} message={message} /> : null}
      // Finished answers can be rated (M6); not while they stream or wait for an Approval.
      meta={canRate(message) ? <AnswerFeedback message={message} meta={meta} /> : meta}
    />
  );
}

/** One stored message, user or assistant. */
export function MessageItem({ message, modelName }: { message: MessageOut; modelName: string }) {
  if (message.role === "user") return <UserMessage content={message.content} />;
  return <StoredAssistantMessage message={message} modelName={modelName} />;
}
