import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallCard } from "@/components/conversation/ToolCallCard";
import { injectionVerdict } from "@/lib/injection";
import { renderWithProviders, toolCall } from "@/test/helpers";

function injectionCall(summary: string | null) {
  return toolCall({ id: "c1", tool: "run_injection_test", decision: "allow", status: "ok", summary });
}

describe("injectionVerdict", () => {
  it("reads the verdict word from the summary", () => {
    expect(injectionVerdict("Vulnerable - 4 of 6 reached the sink")).toBe("vulnerable");
    expect(injectionVerdict("Secure: 0 of 6 reached the sink")).toBe("secure");
    expect(injectionVerdict("0 of 12 probes succeeded")).toBeNull();
    expect(injectionVerdict(null)).toBeNull();
  });
});

describe("InjectionResult in a tool card", () => {
  it("shows a Vulnerable verdict badge and keeps the summary line", () => {
    renderWithProviders(<ToolCallCard call={injectionCall("Vulnerable - 4 of 6 reached the sink")} />);
    expect(screen.getByText("Vulnerable")).toBeInTheDocument();
    expect(screen.getByText("Vulnerable - 4 of 6 reached the sink")).toBeInTheDocument();
    expect(screen.getByText("The suite breached this Target.")).toBeInTheDocument();
  });

  it("shows a Secure verdict badge for a secure run", () => {
    renderWithProviders(<ToolCallCard call={injectionCall("Secure: 0 of 6 reached the sink")} />);
    expect(screen.getByText("Secure")).toBeInTheDocument();
    expect(screen.getByText("The suite did not breach this Target.")).toBeInTheDocument();
  });

  it("falls back to the plain summary when the line has no verdict word", () => {
    renderWithProviders(<ToolCallCard call={injectionCall("0 of 12 probes succeeded")} />);
    expect(screen.getByText("0 of 12 probes succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Secure")).not.toBeInTheDocument();
    expect(screen.queryByText("Vulnerable")).not.toBeInTheDocument();
  });
});
