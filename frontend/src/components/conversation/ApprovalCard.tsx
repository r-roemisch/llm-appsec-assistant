import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, HourglassIcon, PlayIcon, ShieldQuestionMarkIcon, XIcon } from "lucide-react";
import { useContext } from "react";

import { JsonBlock } from "@/components/common/JsonBlock";
import { PluginApprovalNote } from "@/components/common/PluginApprovalNote";
import { PluginBadge } from "@/components/common/PluginBadge";
import { Button } from "@/components/ui/button";
import { useLiveTurn } from "@/hooks/useLiveTurn";
import { useNow } from "@/hooks/useNow";
import { SessionContext } from "@/hooks/useSession";
import { formatCountdown, formatRelativeTime } from "@/lib/format";
import { resumeTurn } from "@/lib/live-turn";
import { toolLabel, toolPhrase, toolPluginId, toolShortLabel } from "@/lib/tools";
import type { ApprovalDecision, ApprovalOut, MessageOut } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ApprovalCardProps {
  approval: ApprovalOut;
  /** The assistant message that waits; a decision continues it. */
  message: MessageOut;
}

/**
 * The Approval a turn waits for: what will run, who must approve, when it
 * expires, and the buttons that decide or continue. Each button starts the
 * stream that continues the answer.
 */
export function ApprovalCard({ approval, message }: ApprovalCardProps) {
  const queryClient = useQueryClient();
  const live = useLiveTurn(message.conversation_id);
  const isAdmin = useContext(SessionContext)?.user.role === "admin";
  const pending = approval.status === "pending";
  const approved = approval.status === "approved";
  const now = useNow(pending || approved ? 1000 : 60_000);
  const expiresAt = Date.parse(approval.expires_at);
  const remaining = expiresAt - now;
  // The server marks an Approval expired when it is next used; the clock knows first.
  // An approved one expires too when it is not used in time.
  const lapsed = remaining <= 0;
  const expired = approval.status === "expired" || ((pending || approved) && lapsed);
  const open = pending && !expired;
  const showExpiry = (open || (approved && !expired)) && !Number.isNaN(expiresAt);
  const busy = live?.status === "streaming";
  const tool = toolLabel(approval.tool);
  const phrase = toolPhrase(approval.tool);
  const pluginId = toolPluginId(approval.tool);
  const byRequester = approval.approver === "requester";

  function act(decision: ApprovalDecision | null) {
    void resumeTurn(queryClient, message, approval.id, decision);
  }

  let heading: string;
  let explanation: string;
  if (open && byRequester) {
    heading = `Approve ${phrase}?`;
    explanation = "The assistant asked to run this tool. It runs only if you approve; reject it and the assistant continues without it.";
  } else if (open) {
    heading = `An administrator must approve ${phrase}`;
    explanation = isAdmin
      ? "You are an administrator, so you can approve it here. Reject it and the assistant continues without it."
      : "It runs only once an administrator approves it. You can reject it to cancel the call; the assistant then continues without it.";
  } else if (expired) {
    heading = "This approval expired";
    explanation = approved
      ? "It was approved but not used in time. Continue to let the assistant finish without the call."
      : "No one decided in time. Continue to let the assistant finish without the call.";
  } else if (approved) {
    heading = approval.decided_by ? `Approved by ${approval.decided_by}` : "Approved";
    explanation = "Continue to run the call and finish the answer.";
  } else if (approval.status === "rejected") {
    heading = approval.decided_by ? `Rejected by ${approval.decided_by}` : "Rejected";
    explanation = "Continue to let the assistant finish without the call.";
  } else {
    heading = "This approval was already used";
    explanation = "Continue to let the assistant finish.";
  }

  return (
    <section
      aria-label="Approval request"
      className={cn("space-y-3 rounded-lg border p-3 text-sm", open ? "border-warning/50 bg-warning/5" : "bg-card")}
    >
      <div className="flex items-start gap-2.5">
        <ShieldQuestionMarkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-medium">{heading}</h3>
          <p className="text-muted-foreground">{explanation}</p>
        </div>
      </div>

      <div className="space-y-1.5 sm:pl-6.5">
        {pluginId && open ? <PluginApprovalNote pluginId={pluginId} /> : null}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{pluginId ? toolShortLabel(approval.tool) : tool}</span>
          {pluginId ? <PluginBadge pluginId={pluginId} /> : null}
          <span className="min-w-0 font-mono wrap-anywhere">{approval.tool}</span>
        </p>
        <JsonBlock value={approval.arguments} label={`Arguments of ${tool} to approve`} />
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 pt-1 text-xs">
          <dt className="text-muted-foreground">Approver</dt>
          <dd>{byRequester ? "You (the requester)" : "An administrator"}</dd>
          {showExpiry ? (
            <>
              <dt className="text-muted-foreground">Expires in</dt>
              <dd className="tabular-nums" aria-live="off">
                {formatCountdown(remaining)}
              </dd>
            </>
          ) : null}
          {approval.decided_at && !open ? (
            <>
              <dt className="text-muted-foreground">Decided</dt>
              <dd>{formatRelativeTime(approval.decided_at, now)}</dd>
            </>
          ) : null}
        </dl>
        <p className="text-xs text-muted-foreground">Approvals are bound to these exact arguments and used once.</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {open ? (
            <>
              {byRequester || isAdmin ? (
                <Button size="sm" disabled={busy} onClick={() => act("approve")}>
                  <CheckIcon />
                  Approve
                </Button>
              ) : null}
              {!byRequester && !isAdmin ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HourglassIcon aria-hidden="true" className="size-3.5" />
                  Waiting for an administrator
                </span>
              ) : null}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act("reject")}>
                <XIcon />
                Reject
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => act(null)}>
              <PlayIcon />
              Continue
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The composer's line while the Conversation waits for a decision on a Tool call. */
export function WaitingForDecisionNotice() {
  return (
    <div className="flex items-start gap-2 px-3 pt-2.5 text-xs text-muted-foreground">
      <HourglassIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
      <span>This conversation is waiting for a decision on a tool call. Decide above to continue.</span>
    </div>
  );
}

/** The decision line of a turn that resumes after an Approval decision. */
export function ApprovalOutcome({ approval, streaming }: { approval: ApprovalOut; streaming: boolean }) {
  const tool = toolPhrase(approval.tool);
  const by = approval.decided_by ? ` by ${approval.decided_by}` : "";
  let text: string;
  switch (approval.status) {
    case "approved":
      text = `${tool} approved${by}`;
      break;
    case "rejected":
      text = `${tool} rejected${by}; the assistant continues without it`;
      break;
    case "expired":
      text = `The approval for ${tool} expired; the assistant continues without it`;
      break;
    case "consumed":
      text = `The approval for ${tool} was used`;
      break;
    default:
      text = `Waiting for an approval of ${tool}`;
  }
  const Icon = approval.status === "approved" ? CheckIcon : approval.status === "pending" ? HourglassIcon : XIcon;
  return (
    <p role="status" className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        {text}
        {streaming ? "…" : "."}
      </span>
    </p>
  );
}
