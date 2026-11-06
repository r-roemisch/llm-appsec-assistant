import { useEffect, useRef } from "react";

import { AssistantMessage, MessageItem, UserMessage } from "@/components/conversation/MessageItem";
import { MessageMeta } from "@/components/conversation/MessageMeta";
import { modelDisplayName } from "@/hooks/useModels";
import type { LiveTurn } from "@/lib/live-turn";
import type { MessageOut, ModelOut } from "@/lib/types";

interface MessageListProps {
  messages: MessageOut[];
  live: LiveTurn | null;
  models: ModelOut[] | undefined;
  /** The Conversation's Model, shown for a live turn until `start` names one. */
  fallbackModelId: string | null;
}

const STICK_THRESHOLD_PX = 80;

/** Chronological messages plus the turn that is streaming, auto-scrolled to the bottom. */
export function MessageList({ messages, live, models, fallbackModelId }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  const liveLength = live?.text.length ?? 0;
  const liveStatus = live?.status ?? null;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, liveLength, liveStatus]);

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stuckToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
  }

  const liveModelId = live?.modelId ?? fallbackModelId;
  const liveProvider = models?.find((model) => model.id === liveModelId)?.provider ?? null;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            modelName={modelDisplayName(models, message.model_id)}
          />
        ))}
        {live ? (
          <>
            <UserMessage content={live.userMessage.content} />
            <AssistantMessage
              content={live.text}
              status={live.status === "error" ? "error" : "streaming"}
              error={live.error}
              meta={
                <MessageMeta
                  modelName={modelDisplayName(models, liveModelId)}
                  provider={liveProvider}
                  inputTokens={live.usage?.input_tokens ?? null}
                  outputTokens={live.usage?.output_tokens ?? null}
                  costUsd={live.usage?.cost_usd ?? null}
                  latencyMs={null}
                  streaming={live.status === "streaming"}
                />
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
