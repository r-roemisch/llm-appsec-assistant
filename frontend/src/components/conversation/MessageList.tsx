import { useEffect, useRef } from "react";

import { ApprovalOutcome } from "@/components/conversation/ApprovalCard";
import { AssistantMessage, MessageItem, UserMessage } from "@/components/conversation/MessageItem";
import { MessageMeta } from "@/components/conversation/MessageMeta";
import { modelDisplayName } from "@/hooks/useModels";
import type { LiveTurn } from "@/lib/live-turn";
import { describeRetrieval, latestRetrievalMode } from "@/lib/retrieval";
import type { MessageOut, ModelOut } from "@/lib/types";

interface MessageListProps {
  messages: MessageOut[];
  live: LiveTurn | null;
  models: ModelOut[] | undefined;
  /** The Conversation's Model, shown for a live turn until `start` names one. */
  fallbackModelId: string | null;
  /** Help mode searches Rampart's guides; the live search line says so. */
  helpMode?: boolean;
}

const STICK_THRESHOLD_PX = 80;

interface LiveAnswerProps {
  live: LiveTurn;
  /** The stored message a resumed turn continues. */
  stored: MessageOut | null;
  models: ModelOut[] | undefined;
  fallbackModelId: string | null;
  helpMode: boolean;
}

/** The answer of the streaming turn: a new one, or a stored one that resumes after an Approval decision. */
function LiveAnswer({ live, stored, models, fallbackModelId, helpMode }: LiveAnswerProps) {
  const modelId = live.modelId ?? stored?.model_id ?? fallbackModelId;
  const provider = models?.find((model) => model.id === modelId)?.provider ?? stored?.provider ?? null;
  const streaming = live.status === "streaming";
  return (
    <AssistantMessage
      content={live.text}
      status={live.status}
      error={live.error}
      citations={live.citations}
      retrieval={describeRetrieval(live.retrieval, helpMode)}
      toolCalls={live.toolCalls}
      guardEvents={live.guardEvents}
      notices={live.notices}
      approval={
        live.approval && (live.mode === "resume" || live.status === "awaiting_approval") ? (
          <ApprovalOutcome approval={live.approval} streaming={streaming} />
        ) : null
      }
      meta={
        <MessageMeta
          modelName={modelDisplayName(models, modelId)}
          provider={provider}
          inputTokens={live.usage?.input_tokens ?? stored?.input_tokens ?? null}
          outputTokens={live.usage?.output_tokens ?? stored?.output_tokens ?? null}
          costUsd={live.usage?.cost_usd ?? stored?.cost_usd ?? null}
          latencyMs={null}
          retrievalMode={latestRetrievalMode(live.retrieval)}
          streaming={streaming}
        />
      }
    />
  );
}

/** Chronological messages plus the turn that is streaming, auto-scrolled to the bottom. */
export function MessageList({ messages, live, models, fallbackModelId, helpMode = false }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  const liveLength = live?.text.length ?? 0;
  const liveStatus = live?.status ?? null;
  const liveSteps = live?.retrieval.length ?? 0;
  const liveCitations = live?.citations.length ?? 0;
  const liveTools = live?.toolCalls;
  const liveGuards = live?.guardEvents.length ?? 0;
  const liveNotices = live?.notices.length ?? 0;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, liveLength, liveStatus, liveSteps, liveCitations, liveTools, liveGuards, liveNotices]);

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stuckToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
  }

  const resumed = live?.mode === "resume" ? live : null;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
        {messages.map((message) =>
          resumed && message.id === resumed.assistantMessageId ? (
            <LiveAnswer
              key={message.id}
              live={resumed}
              stored={message}
              models={models}
              fallbackModelId={fallbackModelId}
              helpMode={helpMode}
            />
          ) : (
            <MessageItem key={message.id} message={message} modelName={modelDisplayName(models, message.model_id)} />
          ),
        )}
        {live && live.mode === "turn" ? (
          <>
            {live.userMessage ? <UserMessage content={live.userMessage.content} /> : null}
            <LiveAnswer live={live} stored={null} models={models} fallbackModelId={fallbackModelId} helpMode={helpMode} />
          </>
        ) : null}
      </div>
    </div>
  );
}
