import { describe, expect, it } from "vitest";

import {
  argumentSummary,
  humanize,
  mergeToolCall,
  reasonLabel,
  toolCallState,
  toolCallUpdate,
  toolLabel,
} from "@/lib/tools";
import { toolCall } from "@/test/helpers";

describe("tool labels", () => {
  it("names the built-in Tools and humanizes the rest", () => {
    expect(toolLabel("lookup_vulnerabilities")).toBe("Look up known vulnerabilities");
    expect(toolLabel("generate_report")).toBe("Generate a report");
    expect(toolLabel("scan_sbom")).toBe("Scan sbom");
    expect(humanize("plugin:acme-scan")).toBe("Plugin acme scan");
    expect(reasonLabel("rate_limited")).toBe("Rate limit reached");
    expect(reasonLabel("approval_mismatch")).toBe("Arguments differ from the approved ones");
    expect(reasonLabel("brand_new_reason")).toBe("Brand new reason");
  });

  it("summarizes up to three scalar arguments and skips nested ones", () => {
    expect(argumentSummary({ ecosystem: "PyPI", name: "requests", version: "2.25.0", extra: "x" })).toBe(
      "ecosystem: PyPI · name: requests · version: 2.25.0",
    );
    expect(argumentSummary({ packages: [{ name: "a" }], verbose: true })).toBe("verbose: true");
    expect(argumentSummary({ prompt: "a".repeat(60) })).toBe(`prompt: ${"a".repeat(47)}…`);
    expect(argumentSummary({})).toBe("");
  });
});

describe("tool call events", () => {
  it("derives the stored status from the Gateway decision, like the server", () => {
    const base = { id: "call_1", tool: "run_injection_test", arguments: {}, reason_code: "x", message: "m", approval_id: null };
    expect(toolCallUpdate("tool_call", { ...base, decision: "approval_required" })?.status).toBe("pending");
    expect(toolCallUpdate("tool_call", { ...base, decision: "deny" })?.status).toBe("denied");
    expect(toolCallUpdate("tool_call", { ...base, decision: "allow" })?.status).toBeNull();
    expect(toolCallUpdate("tool_result", { id: "call_1", status: "ok", summary: "done" })).toMatchObject({
      id: "call_1",
      status: "ok",
      summary: "done",
    });
    expect(toolCallUpdate("tool_call", { tool: "x" })).toBeNull();
  });

  it("merges by id in order, never overwriting with null", () => {
    const first = mergeToolCall([], { id: "call_1", tool: "lookup_vulnerabilities", decision: "allow", arguments: { name: "requests" } });
    const second = mergeToolCall(first, { id: "call_2", tool: "generate_report", decision: "allow" });
    const merged = mergeToolCall(second, { id: "call_1", status: "ok", summary: "8 known vulnerabilities", provenance: null });

    expect(merged.map((call) => call.id)).toEqual(["call_1", "call_2"]);
    expect(merged[0]).toEqual(
      toolCall({
        id: "call_1",
        tool: "lookup_vulnerabilities",
        decision: "allow",
        arguments: { name: "requests" },
        status: "ok",
        summary: "8 known vulnerabilities",
      }),
    );
    // An approval granted later keeps the stored "pending" until the result arrives.
    const waiting = [toolCall({ id: "call_3", tool: "run_injection_test", decision: "approval_required", status: "pending" })];
    const approved = mergeToolCall(waiting, toolCallUpdate("tool_call", {
      id: "call_3",
      tool: "run_injection_test",
      arguments: {},
      decision: "allow",
      reason_code: "approved",
      message: "approved by the user",
      approval_id: "ap1",
    })!);
    expect(approved[0]).toMatchObject({ decision: "allow", reason_code: "approved", status: "pending" });
    expect(toolCallState(approved[0], true)).toBe("running");
  });

  it("maps each call to one visual state", () => {
    const call = (overrides: Parameters<typeof toolCall>[0]) => toolCall(overrides);
    expect(toolCallState(call({ id: "1", tool: "t", decision: "allow" }), true)).toBe("running");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "allow" }), false)).toBe("unfinished");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "allow", status: "ok" }), false)).toBe("allowed");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "allow", status: "error" }), false)).toBe("error");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "deny", status: "denied" }), true)).toBe("denied");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "deny" }), false)).toBe("denied");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "approval_required", status: "pending" }), false)).toBe("waiting");
    expect(toolCallState(call({ id: "1", tool: "t", decision: "deny", status: "rejected" }), false)).toBe("rejected");
  });
});
