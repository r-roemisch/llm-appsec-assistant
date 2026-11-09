import { ChevronRightIcon, OctagonPauseIcon, ShieldBanIcon, ShieldCheckIcon } from "lucide-react";

import { guardNotices, type GroupedGuardNotice } from "@/lib/guards";
import { noticeDetail, noticeTitle } from "@/lib/notices";
import type { GuardEventOut, TurnNoticeData } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Above an answer that the input guard gave instead of a Model. */
export function BlockedLabel() {
  return (
    <span className="inline-flex h-5 w-fit items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 text-xs font-medium text-warning">
      <ShieldBanIcon aria-hidden="true" className="size-3" />
      Blocked by the input guard
    </span>
  );
}

function NoticeLine({ notice }: { notice: GroupedGuardNotice }) {
  const Icon = notice.tone === "blocked" ? ShieldBanIcon : ShieldCheckIcon;
  const text = (
    <>
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-3.5 shrink-0", notice.tone === "blocked" ? "text-warning" : "text-primary/80")}
      />
      <span className="min-w-0">
        {notice.text}
        {notice.count > 1 ? <span className="tabular-nums"> ({notice.count}×)</span> : null}
      </span>
    </>
  );
  if (notice.details.length === 0) return <div className="flex items-start gap-1.5">{text}</div>;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        {text}
        <ChevronRightIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-1 space-y-1 pl-5 wrap-anywhere text-muted-foreground/90">
        {notice.details.map((detail) => (
          <p key={detail}>{detail}</p>
        ))}
      </div>
    </details>
  );
}

/** What the Guards did during a turn, as quiet lines under the answer; each opens its detail. */
export function GuardNotices({ events }: { events: readonly GuardEventOut[] }) {
  const notices = guardNotices(events);
  if (notices.length === 0) return null;
  return (
    <ul aria-label="Guard notices" className="space-y-1 text-xs text-muted-foreground">
      {notices.map((notice) => (
        <li key={notice.text}>
          <NoticeLine notice={notice} />
        </li>
      ))}
    </ul>
  );
}

/** Why Rampart stopped the turn early: the token budget or the model-call limit. */
export function StopNotices({ notices, answer }: { notices: readonly TurnNoticeData[]; answer: string }) {
  if (notices.length === 0) return null;
  return (
    <div className="space-y-2">
      {notices.map((notice, index) => {
        const detail = noticeDetail(notice.message, answer);
        return (
          <div
            key={`${notice.kind}-${index}`}
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            <OctagonPauseIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{noticeTitle(notice.kind)}</p>
              {detail ? <p className="text-muted-foreground">{detail}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
