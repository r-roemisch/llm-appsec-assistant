import { describe, expect, it } from "vitest";

import {
  approxCost,
  formatElapsed,
  formatRatio,
  formatScore,
  isGuardMetrics,
  metricLabel,
  metricSummary,
  parseCaseLimit,
  runButtonLabel,
  runCasesText,
  runDuration,
  runsPollInterval,
  suiteLabel,
} from "@/lib/eval";
import { evalRun, guardSet } from "@/test/helpers";

describe("evaluation metric summaries (M6)", () => {
  it("gives each qa metric's mean with passed/scored, in the report's order, and what did not count", () => {
    const run = evalRun({
      id: "r1",
      metrics: {
        contextual_recall: { mean: 0.75, passed: 2, scored: 2, skipped: 1, errors: 0, total: 3 },
        faithfulness: { mean: 0.9167, passed: 3, scored: 3, skipped: 0, errors: 0, total: 3 },
        answer_relevancy: { mean: null, passed: 0, scored: 0, skipped: 1, errors: 2, total: 3 },
        contextual_precision: { mean: 1, passed: 1, scored: 1, skipped: 0, errors: 1, total: 3 },
      },
    });
    expect(metricSummary(run)).toEqual([
      { label: "Faithfulness", value: "0.92", detail: "3/3 passed" },
      { label: "Answer relevancy", value: "—", detail: "0/0 passed, 1 skipped, 2 judge errors" },
      { label: "Contextual precision", value: "1.00", detail: "1/1 passed, 1 judge error" },
      { label: "Contextual recall", value: "0.75", detail: "2/2 passed, 1 skipped" },
    ]);
  });

  it("gives tool correctness as passed/total", () => {
    const run = evalRun({
      id: "r2",
      kind: "deepeval_tool",
      suite: "tool",
      metrics: { tool_correctness: { mean: 0.9, passed: 18, scored: 19, skipped: 0, errors: 1, total: 20 } },
    });
    expect(metricSummary(run)).toEqual([{ label: "Tool correctness", value: "18/20 passed", detail: "1 judge error" }]);
    expect(
      metricSummary({ suite: "tool", metrics: { tool_correctness: { mean: 1, passed: 20, scored: 20, skipped: 0, errors: 0, total: 20 } } }),
    ).toEqual([{ label: "Tool correctness", value: "20/20 passed", detail: null }]);
  });

  it("gives precision, recall and the false-positive rate of both guard sets", () => {
    const metrics = {
      cases: guardSet(),
      holdout: guardSet({ adversarial: 15, benign: 15, precision: null, recall: 0.4, false_positive_rate: 0.0667 }),
    };
    expect(isGuardMetrics(metrics)).toBe(true);
    expect(metricSummary({ suite: "guard", metrics })).toEqual([
      { label: "Written set", value: "precision 100.0% · recall 96.2% · FPR 0.0%", detail: "52 adversarial, 52 benign" },
      { label: "Held-out set", value: "precision — · recall 40.0% · FPR 6.7%", detail: "15 adversarial, 15 benign" },
    ]);
  });

  it("shows nothing for a run without metrics, and ignores what it cannot read", () => {
    expect(metricSummary({ suite: "qa", metrics: null })).toEqual([]);
    expect(isGuardMetrics({ faithfulness: {} })).toBe(false);
    expect(
      metricSummary({
        suite: "qa",
        metrics: { faithfulness: "broken", custom_metric: { mean: 0.5, passed: 1, scored: 2, skipped: 0, errors: 0, total: 2 } },
      } as never),
    ).toEqual([{ label: "Custom metric", value: "0.50", detail: "1/2 passed" }]);
  });

  it("formats scores, ratios and metric names", () => {
    expect(formatScore(0.9167)).toBe("0.92");
    expect(formatScore(null)).toBe("—");
    expect(formatRatio(0.9615)).toBe("96.2%");
    expect(formatRatio(undefined)).toBe("—");
    expect(metricLabel("answer_relevancy")).toBe("Answer relevancy");
    expect(metricLabel("new_metric")).toBe("New metric");
  });
});

describe("evaluation runs and estimates (M6)", () => {
  it("names the confirm button after the total shown", () => {
    expect(runButtonLabel(0.2077)).toBe("Run for about $0.21");
    expect(runButtonLabel(12.4)).toBe("Run for about $12.40");
    expect(runButtonLabel(0.004)).toBe("Run for less than $0.01");
    expect(runButtonLabel(0)).toBe("Run (free)");
    expect(runButtonLabel(null)).toBe("Run (cost unknown)");
    expect(approxCost(0.2077)).toBe("$0.21");
    expect(approxCost(0)).toBe("$0");
  });

  it("polls only while a run is queued or running", () => {
    expect(runsPollInterval(undefined)).toBe(false);
    expect(runsPollInterval([])).toBe(false);
    expect(runsPollInterval([{ status: "done" }, { status: "failed" }])).toBe(false);
    expect(runsPollInterval([{ status: "done" }, { status: "queued" }])).toBe(3000);
    expect(runsPollInterval([{ status: "running" }])).toBe(3000);
  });

  it("checks the case limit like the server", () => {
    expect(parseCaseLimit(" ")).toEqual({ ok: true, value: null });
    expect(parseCaseLimit("3")).toEqual({ ok: true, value: 3 });
    expect(parseCaseLimit("500")).toEqual({ ok: true, value: 500 });
    for (const bad of ["0", "-1", "2.5", "501", "abc"]) expect(parseCaseLimit(bad)).toMatchObject({ ok: false });
  });

  it("describes suites, durations and case counts", () => {
    expect(suiteLabel("qa")).toBe("Answer quality (qa)");
    expect(suiteLabel("all")).toBe("All suites");
    expect(formatElapsed(45_000)).toBe("45 s");
    expect(formatElapsed(133_000)).toBe("2 min 13 s");
    expect(formatElapsed(120_000)).toBe("2 min");
    expect(formatElapsed(3_900_000)).toBe("1 h 5 min");
    expect(runDuration({ created_at: "2026-11-09T07:32:00Z", finished_at: "2026-11-09T07:34:15Z" })).toBe("2 min 15 s");
    expect(runDuration({ created_at: "2026-11-09T07:32:00Z", finished_at: null })).toBeNull();
    expect(runCasesText({ case_count: 3, case_limit: 3 })).toBe("3 cases (the first 3)");
    expect(runCasesText({ case_count: 134, case_limit: null })).toBe("134 cases");
    expect(runCasesText({ case_count: null, case_limit: null })).toBe("Cases not counted yet");
  });
});
