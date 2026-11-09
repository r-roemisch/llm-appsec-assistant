import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApprovalsTab } from "@/components/admin/ApprovalsTab";
import { ToolsTab } from "@/components/admin/ToolsTab";
import { ApprovalCard, ApprovalOutcome } from "@/components/conversation/ApprovalCard";
import { ToolCallCard } from "@/components/conversation/ToolCallCard";
import { SessionContext } from "@/hooks/useSession";
import { session } from "@/lib/session";
import type { ApprovalOut } from "@/lib/types";
import {
  aliceSession,
  approval,
  bobSession,
  jsonResponse,
  message,
  mockFetch,
  renderWithProviders,
  tool,
  toolCall,
} from "@/test/helpers";

const pluginApproval = (overrides: Partial<ApprovalOut> = {}) =>
  approval({ tool: "fixture_docs__read_doc", arguments: { doc_id: "vendor-faq" }, ...overrides });

describe("Admin: Tools with Plugin Tools (M5)", () => {
  beforeEach(() => session.set(bobSession));
  afterEach(() => session.clear());

  it("marks Plugin Tools with their Plugin and says why a blocked one cannot run", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/tools") {
        return jsonResponse(200, [
          tool({ name: "lookup_vulnerabilities", cost_class: "api" }),
          tool({
            name: "fixture_docs__read_doc",
            description: "(Plugin fixture_docs) Read one note by its id.",
            contributed_by: "plugin:fixture_docs",
            requires_approval: true,
            cost_class: "heavy",
            blocked: "plugin_drift",
          }),
          tool({
            name: "secret_scanner__scan_text",
            contributed_by: "plugin:secret_scanner",
            enabled: false,
            requires_approval: true,
            cost_class: "heavy",
          }),
          tool({ name: "gone__fetch", contributed_by: "plugin:gone", requires_approval: true, blocked: "plugin_missing" }),
          tool({ name: "paused__ping", contributed_by: "plugin:paused", requires_approval: true, blocked: "plugin_disabled" }),
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderWithProviders(<ToolsTab />);

    const row = (await screen.findByText("fixture_docs__read_doc")).closest("tr")!;
    expect(within(row).getByText("Read doc")).toBeInTheDocument();
    expect(within(row).getByText("Plugin: fixture_docs")).toBeInTheDocument();
    expect(within(row).getByText("Blocked: definitions changed")).toBeInTheDocument();
    expect(within(row).getByText(/this switch alone does not unblock it/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Open fixture_docs on the Plugins tab" })).toHaveAttribute(
      "href",
      "/admin?tab=plugins&plugin=fixture_docs",
    );
    const toggle = within(row).getByRole("switch", { name: "Read doc (Plugin fixture_docs) enabled" });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/this switch alone does not unblock it/);

    const scanner = screen.getByText("secret_scanner__scan_text").closest("tr")!;
    expect(within(scanner).getByText("Plugin: secret_scanner")).toBeInTheDocument();
    expect(within(scanner).queryByText(/^Blocked/)).not.toBeInTheDocument();
    expect(within(scanner).getByRole("switch", { name: "Scan text (Plugin secret_scanner) enabled" })).not.toBeChecked();

    expect(screen.getByText("gone__fetch").closest("tr")).toHaveTextContent("Blocked: not in catalog");
    expect(screen.getByText("paused__ping").closest("tr")).toHaveTextContent("Blocked: Plugin disabled");

    const builtin = screen.getByText("Look up known vulnerabilities").closest("tr")!;
    expect(within(builtin).queryByText(/^Plugin/)).not.toBeInTheDocument();
    expect(within(builtin).queryByText(/^Blocked/)).not.toBeInTheDocument();
    expect(within(builtin).getByText("builtin")).toBeInTheDocument();
  });

  it("says on an admin Approval that a Plugin Tool is third-party code", async () => {
    mockFetch((url) => {
      if (url === "/api/admin/approvals?status=pending&approver=admin") {
        return jsonResponse(200, [pluginApproval({ approver: "admin" })]);
      }
      if (url === "/api/admin/approvals") return jsonResponse(200, []);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderWithProviders(<ApprovalsTab />);

    const item = await screen.findByRole("listitem", { name: "Approval for Read doc (Plugin fixture_docs) requested by alice" });
    expect(item).toHaveTextContent("This Tool comes from the Plugin fixture_docs: third-party code that runs on the Rampart server");
  });
});

describe("Plugin Tools in a conversation (M5)", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("names the Plugin on a tool card and reads its result as untrusted Plugin output", () => {
    renderWithProviders(
      <>
        <ToolCallCard
          call={toolCall({
            id: "call_1",
            tool: "fixture_docs__read_doc",
            contributed_by: "plugin:fixture_docs",
            arguments: { doc_id: "vendor-faq" },
            decision: "allow",
            reason_code: "approved",
            status: "ok",
            summary: "# Vendor FAQ <b>(third-party page)</b>",
            provenance: "plugin",
          })}
        />
        <ToolCallCard
          call={toolCall({
            id: "call_2",
            tool: "fixture_docs__search_docs",
            contributed_by: "plugin:fixture_docs",
            decision: "deny",
            reason_code: "plugin_drift",
            message:
              "the Plugin's tool definitions changed since an administrator accepted them; an administrator must review and accept the change first",
            status: "denied",
          })}
        />
        <ToolCallCard
          call={toolCall({
            id: "call_3",
            tool: "lookup_vulnerabilities",
            contributed_by: "builtin",
            decision: "allow",
            status: "ok",
            summary: "8 known vulnerabilities in requests 2.25.0",
            provenance: "API",
          })}
        />
      </>,
    );

    const card = screen.getByRole("article", { name: "Tool call: Read doc (Plugin fixture_docs)" });
    expect(within(card).getByRole("heading", { name: "Read doc" })).toBeInTheDocument();
    expect(within(card).getByText("Plugin fixture_docs")).toBeInTheDocument();
    expect(within(card).getByText("Ran after approval.")).toBeInTheDocument();
    expect(within(card).getByText("Result from: Plugin fixture_docs (untrusted output)")).toBeInTheDocument();
    // The result summary is the server's text, shown as text.
    expect(within(card).getByText("# Vendor FAQ <b>(third-party page)</b>")).toBeInTheDocument();
    expect(card.querySelector("b")).toBeNull();
    expect(within(card).getByLabelText("Arguments of Read doc (Plugin fixture_docs)")).toHaveTextContent('"doc_id": "vendor-faq"');

    const denied = screen.getByRole("article", { name: "Tool call: Search docs (Plugin fixture_docs)" });
    expect(denied).toHaveTextContent("Plugin changed since it was accepted: the Plugin's tool definitions changed");

    const builtin = screen.getByRole("article", { name: "Tool call: Look up known vulnerabilities" });
    expect(within(builtin).queryByText(/^Plugin/)).not.toBeInTheDocument();
    expect(within(builtin).getByText("Result from: External API")).toBeInTheDocument();
  });

  it("reads the Plugin from the name for calls stored without contributed_by", () => {
    renderWithProviders(
      <ToolCallCard call={{ ...toolCall({ id: "call_1", tool: "secret_scanner__scan_text", decision: "allow" }), contributed_by: undefined as unknown as null }} />,
    );
    expect(screen.getByRole("article", { name: "Tool call: Scan text (Plugin secret_scanner)" })).toHaveTextContent(
      "Plugin secret_scanner",
    );
  });

  it("tells the requester that a Plugin Tool is third-party code before they approve it", () => {
    const pending = pluginApproval();
    const waiting = message({ id: "a1", role: "assistant", status: "awaiting_approval", pending_approval: pending });
    renderWithProviders(
      <SessionContext value={aliceSession}>
        <ApprovalCard approval={pending} message={waiting} />
      </SessionContext>,
    );

    expect(screen.getByRole("heading", { name: "Approve “Read doc” from Plugin fixture_docs?" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Approval request" });
    expect(card).toHaveTextContent(
      "This Tool comes from the Plugin fixture_docs: third-party code that runs on the Rampart server, not part of Rampart itself.",
    );
    expect(within(card).getByText("Plugin fixture_docs")).toBeInTheDocument();
    expect(within(card).getByText("fixture_docs__read_doc")).toBeInTheDocument();
    expect(within(card).getByLabelText("Arguments of Read doc (Plugin fixture_docs) to approve")).toHaveTextContent(
      '"doc_id": "vendor-faq"',
    );
    expect(within(card).getAllByRole("button").map((button) => button.textContent)).toEqual(["Approve", "Reject"]);
  });

  it("names the Plugin in the decision line of a resumed turn", () => {
    renderWithProviders(
      <ApprovalOutcome approval={pluginApproval({ status: "approved", decided_by: "alice" })} streaming={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("“Read doc” from Plugin fixture_docs approved by alice.");
  });
});
