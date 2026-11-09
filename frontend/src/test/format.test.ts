import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCompact,
  formatCost,
  formatCount,
  formatCountdown,
  formatDate,
  formatLatency,
  formatRelativeTime,
  formatShortDateTime,
  formatTokens,
} from "@/lib/format";

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

describe("formatBytes", () => {
  it("uses binary units, like the upload limit", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12_345)).toBe("12 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1 MB");
  });
});

describe("formatCount", () => {
  it("picks the singular or plural noun", () => {
    expect(formatCount(1, "passage")).toBe("1 passage");
    expect(formatCount(0, "passage")).toBe("0 passages");
    expect(formatCount(1284, "passage")).toBe("1,284 passages");
  });
});

describe("formatDate", () => {
  it("formats a date and returns an empty string for invalid input", () => {
    expect(formatDate("2026-11-06T12:00:00Z")).toBe("Nov 6, 2026");
    expect(formatDate("not a date")).toBe("");
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

describe("formatCountdown", () => {
  it("shows minutes and seconds below an hour", () => {
    expect(formatCountdown(15 * 60_000)).toBe("15:00");
    expect(formatCountdown(14 * 60_000 + 5_000)).toBe("14:05");
    expect(formatCountdown(42_000)).toBe("0:42");
    expect(formatCountdown(400)).toBe("0:01");
  });

  it("shows hours and days for long approvals", () => {
    expect(formatCountdown(24 * 3_600_000)).toBe("1 d");
    expect(formatCountdown(23 * 3_600_000 + 59 * 60_000)).toBe("23 h 59 min");
    expect(formatCountdown(3 * 3_600_000)).toBe("3 h");
    expect(formatCountdown(50 * 3_600_000)).toBe("2 d 2 h");
  });

  it("stops at zero", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
  });
});

describe("formatShortDateTime", () => {
  it("leaves out the current year and keeps seconds", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const text = formatShortDateTime("2026-11-08T10:15:30Z", now);
    expect(text).toMatch(/^Nov \d{1,2}, \d{1,2}:\d{2}:30\s?[AP]M$/);
    expect(formatShortDateTime("2025-03-01T10:15:30Z", now)).toContain("2025");
    expect(formatShortDateTime("not a date", now)).toBe("");
  });
});
