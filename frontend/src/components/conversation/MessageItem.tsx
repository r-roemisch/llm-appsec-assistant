import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { RampartMark } from "@/components/common/Brand";
import { Markdown } from "@/components/conversation/Markdown";
import { MessageMeta } from "@/components/conversation/MessageMeta";
import type { MessageOut, MessageStatus } from "@/lib/types";

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
        {content}
      </div>
    </div>
  );
}

interface AssistantMessageProps {
  content: string;
  status: MessageStatus;
  error: string | null;
  meta: ReactNode;
}

export function AssistantMessage({ content, status, error, meta }: AssistantMessageProps) {
  const streaming = status === "streaming";
  return (
    <div className="flex gap-3">
      <RampartMark className="mt-1 size-5 opacity-80" />
      <div className="min-w-0 flex-1 space-y-2.5">
        {content ? (
          <Markdown content={content} streaming={streaming} />
        ) : streaming ? (
          <p className="streaming-caret text-sm text-muted-foreground" aria-live="polite" aria-label="Waiting for the answer" />
        ) : (
          <p className="text-sm text-muted-foreground italic">No answer</p>
        )}
        {status === "error" ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error ?? "The answer failed"}</span>
          </div>
        ) : null}
        {meta}
      </div>
    </div>
  );
}

/** One stored message, user or assistant. */
export function MessageItem({ message, modelName }: { message: MessageOut; modelName: string }) {
  if (message.role === "user") return <UserMessage content={message.content} />;
  return (
    <AssistantMessage
      content={message.content}
      status={message.status}
      error={message.error}
      meta={
        <MessageMeta
          modelName={modelName}
          provider={message.provider}
          inputTokens={message.input_tokens}
          outputTokens={message.output_tokens}
          costUsd={message.cost_usd}
          latencyMs={message.latency_ms}
          streaming={message.status === "streaming"}
        />
      }
    />
  );
}
