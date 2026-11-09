import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApprovalCard } from "@/components/conversation/ApprovalCard";
import { ToolCallCard } from "@/components/conversation/ToolCallCard";
import { SessionContext } from "@/hooks/useSession";
import { getLiveTurn } from "@/lib/live-turn";
import { session } from "@/lib/session";
import type { ApprovalOut, SessionOut } from "@/lib/types";
import {
  aliceSession,
  approval,
  bobSession,
  callsTo,
  message,
  mockFetch,
  renderWithProviders,
  sseEvent,
  sseResponse,
  toolCall,
} from "@/test/helpers";

function renderCard(pending: ApprovalOut, viewer: SessionOut = aliceSession) {
  const waiting = message({
    id: "a1",
    role: "assistant",
    content: "I'll run the basic suite.",
    status: "awaiting_approval",
    pending_approval: pending,
  });
  return renderWithProviders(
    <SessionContext value={viewer}>
      <ApprovalCard approval={pending} message={waiting} />
    </SessionContext>,
  );
}

function buttonNames(): string[] {
  const card = screen.getByRole("region", { name: "Approval request" });
  return within(card)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("ApprovalCard", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("lets the requester approve or reject, with what runs, who approves and the expiry", () => {
    renderCard(approval({ expires_at: new Date(Date.now() + 14 * 60_000 + 30_000).toISOString() }));

    expect(buttonNames()).toEqual(["Approve", "Reject"]);
    expect(screen.getByRole("heading", { name: "Approve “Run an injection test”?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Arguments of Run an injection test to approve")).toHaveTextContent('"target_id": "t-staging"');
    expect(screen.getByText("You (the requester)")).toBeInTheDocument();
    expect(screen.getByText(/^14:(2\d|30)$/)).toBeInTheDocument();
    expect(screen.getByText("Approvals are bound to these exact arguments and used once.")).toBeInTheDocument();
  });

  it("waits for an administrator and lets the requester only reject", () => {
    renderCard(approval({ approver: "admin" }));

    expect(buttonNames()).toEqual(["Reject"]);
    expect(screen.getByText("Waiting for an administrator")).toBeInTheDocument();
    expect(screen.getByText("An administrator")).toBeInTheDocument();
  });

  it("lets an administrator approve an admin Approval of their own", () => {
    renderCard(approval({ approver: "admin", requested_by: "bob" }), bobSession);

    expect(buttonNames()).toEqual(["Approve", "Reject"]);
    expect(screen.queryByText("Waiting for an administrator")).not.toBeInTheDocument();
  });

  it.each([
    // [state, Approval, heading, still counts down]
    ["approved", approval({ approver: "admin", status: "approved", decided_by: "bob", decided_at: new Date().toISOString() }), "Approved by bob", true],
    ["rejected", approval({ approver: "admin", status: "rejected", decided_by: "bob", decided_at: new Date().toISOString() }), "Rejected by bob", false],
    ["expired", approval({ status: "expired" }), "This approval expired", false],
    ["past its expiry", approval({ expires_at: new Date(Date.now() - 1000).toISOString() }), "This approval expired", false],
    [
      "approved but not used in time",
      approval({ status: "approved", decided_by: "bob", expires_at: new Date(Date.now() - 1000).toISOString() }),
      "This approval expired",
      false,
    ],
  ] as const)("offers Continue once the Approval is %s", (_label, decided, heading, countsDown) => {
    renderCard(decided);

    expect(buttonNames()).toEqual(["Continue"]);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    // Only an Approval that can still be used counts down.
    if (countsDown) expect(screen.getByText("Expires in")).toBeInTheDocument();
    else expect(screen.queryByText("Expires in")).not.toBeInTheDocument();
  });

  it("approves through the decision endpoint and continues through the continue endpoint", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("/api/conversations/c1/approvals/ap1")) {
        return sseResponse([sseEvent("resume", { assistant_message_id: "a1", approval: approval({ status: "approved" }) })]);
      }
      if (url === "/api/conversations/c1") throw new Error("not loaded in this test");
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    const first = renderCard(approval());

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(callsTo(fetchMock, "/api/conversations/c1/approvals/ap1", "POST")).toHaveLength(1));
    const [decide] = callsTo(fetchMock, "/api/conversations/c1/approvals/ap1", "POST");
    expect(JSON.parse(String(decide.body))).toEqual({ decision: "approve" });
    expect(new Headers(decide.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    // One stream per Conversation: let the first one finish.
    await waitFor(() => expect(getLiveTurn("c1")).toBeNull());
    first.unmount();

    renderCard(approval({ status: "rejected", decided_by: "bob" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(callsTo(fetchMock, "/api/conversations/c1/approvals/ap1/continue", "POST")).toHaveLength(1));
  });
});

describe("ToolCallCard", () => {
  it("shows the readable name, key arguments, the decision and the result", () => {
    renderWithProviders(
      <ToolCallCard
        call={toolCall({
          id: "call_1",
          tool: "lookup_vulnerabilities",
          arguments: { ecosystem: "PyPI", name: "requests", version: "2.25.0" },
          decision: "allow",
          reason_code: "allowed",
          status: "ok",
          summary: "8 known vulnerabilities in requests 2.25.0",
          provenance: "API",
        })}
      />,
    );

    const card = screen.getByRole("article", { name: "Tool call: Look up known vulnerabilities" });
    expect(card).toHaveAttribute("data-state", "allowed");
    expect(within(card).getByText("Allowed")).toBeInTheDocument();
    expect(within(card).getByText("ecosystem: PyPI · name: requests · version: 2.25.0")).toBeInTheDocument();
    expect(within(card).getByText("8 known vulnerabilities in requests 2.25.0")).toBeInTheDocument();
    expect(within(card).getByText("Result from: External API")).toBeInTheDocument();
    expect(within(card).getByLabelText("Arguments of Look up known vulnerabilities")).not.toBeVisible();
  });

  it("explains a denial and links a generated report", () => {
    renderWithProviders(
      <>
        <ToolCallCard
          call={toolCall({
            id: "call_1",
            tool: "run_injection_test",
            decision: "deny",
            reason_code: "rate_limited",
            message: "at most 5 calls per hour",
            status: "denied",
            summary: "at most 5 calls per hour",
          })}
        />
        <ToolCallCard
          call={toolCall({ id: "call_2", tool: "generate_report", decision: "allow", status: "ok", summary: "Report saved", report_id: "r 1" })}
        />
        <ToolCallCard call={toolCall({ id: "call_3", tool: "search_knowledge", decision: "allow" })} live />
      </>,
    );

    const denied = screen.getByRole("article", { name: "Tool call: Run an injection test" });
    expect(within(denied).getByText("Denied")).toBeInTheDocument();
    expect(denied).toHaveTextContent("Rate limit reached: at most 5 calls per hour");
    expect(screen.getByRole("link", { name: "Open the report" })).toHaveAttribute("href", "/reports/r%201");
    expect(within(screen.getByRole("article", { name: "Tool call: Search the Knowledge Base" })).getByText("Running")).toBeInTheDocument();
  });
});
