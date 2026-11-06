import { describe, expect, it } from "vitest";

import { formatCompact, formatCost, formatLatency, formatRelativeTime, formatTokens } from "@/lib/format";

describe("formatCost", () => {
  it("shows an em dash for unknown cost", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("shows $0 for zero", () => {
    expect(formatCost(0)).toBe("$0");
  });

  it("uses up to four decimals below a dollar", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
    expect(formatCost(0.000201)).toBe("$0.0002");
    expect(formatCost(0.12)).toBe("$0.12");
    expect(formatCost(0.1)).toBe("$0.10");
    expect(formatCost(0.5678)).toBe("$0.5678");
  });

  it("uses two decimals from a dollar up", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(12.345)).toBe("$12.35");
  });

  it("marks amounts below a hundredth of a cent", () => {
    expect(formatCost(0.00001)).toBe("<$0.0001");
  });
});

describe("formatTokens", () => {
  it("formats counts", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(15_600)).toBe("15.6k");
    expect(formatTokens(2_300_000)).toBe("2.3M");
  });
});

describe("formatCompact", () => {
  it("groups small numbers and compacts large ones", () => {
    expect(formatCompact(1284)).toBe("1,284");
    expect(formatCompact(12_900)).toBe("12.9k");
  });
});

describe("formatLatency", () => {
  it("formats milliseconds and seconds", () => {
    expect(formatLatency(null)).toBe("—");
    expect(formatLatency(840)).toBe("840 ms");
    expect(formatLatency(1234)).toBe("1.2 s");
    expect(formatLatency(34_000)).toBe("34 s");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");

  it("describes recent times relative to now", () => {
    expect(formatRelativeTime("2026-11-06T11:59:50Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-06T11:55:00Z", now)).toBe("5 min ago");
    expect(formatRelativeTime("2026-11-06T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("2026-11-04T12:00:00Z", now)).toBe("2 d ago");
  });

  it("treats future timestamps as just now", () => {
    expect(formatRelativeTime("2026-11-06T12:05:00Z", now)).toBe("just now");
  });

  it("falls back to a date after a week", () => {
    expect(formatRelativeTime("2026-10-12T12:00:00Z", now)).toBe("Oct 12");
    expect(formatRelativeTime("2025-10-12T12:00:00Z", now)).toBe("Oct 12, 2025");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelativeTime("not a date", now)).toBe("");
  });
});
