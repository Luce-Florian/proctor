import { describe, expect, it } from "vitest"
import { aggregate, aggregatesOf, stat } from "./aggregates.ts"
import { renderHtml } from "./html.ts"
import { renderMarkdown } from "./markdown.ts"
import { report, tests, trial } from "#test/reports.ts"

describe("aggregate", () => {
  it("computes mean and sample standard deviation", () => {
    expect(stat([8, 10, 11])).toEqual({ mean: 29 / 3, sd: expect.closeTo(1.5275, 4), n: 3 })
    expect(stat([4])).toEqual({ mean: 4, sd: 0, n: 1 })
    expect(stat([])).toBeUndefined()
  })

  it("aggregates each case × variant over its graded trials, infra errors left out", () => {
    const { aggregates } = aggregate(tests)
    const [baseline, withSdlc] = aggregates.groups

    expect(baseline).toMatchObject({
      caseId: "review",
      variant: "baseline",
      trials: 2,
      passed: 1,
      failed: 1,
      principal: { met: 2, of: 2 },
      judgeCalls: 3,
    })
    expect(baseline?.criteria).toMatchObject({ mean: 0.5, n: 2 }) // 2/3 and 1/3
    expect(baseline?.decoys).toMatchObject({ mean: 0.5, n: 2 })
    expect(baseline?.costUsd?.mean).toBeCloseTo(0.4)
    expect(withSdlc).toMatchObject({ trials: 2, passed: 1, other: 1, criteria: { mean: 1, n: 1 } })
    expect(aggregates.judge.calls).toBe(4)
    expect(aggregates.judge.costUsd).toBeCloseTo(0.2)
  })

  it("averages the duration over graded trials, and counts principal only where a trial has one", () => {
    const [baseline, withSdlc] = aggregate(tests).aggregates.groups
    const noPrincipal = aggregate([trial("baseline", 1, [], {}, "passed"), trial("baseline", 2, [], {}, "passed")]).aggregates.groups[0]

    expect(baseline?.durationMs).toMatchObject({ mean: 1500, n: 2 })
    expect(withSdlc?.durationMs).toMatchObject({ mean: 1000, n: 1 })
    expect(noPrincipal?.principal).toBeUndefined()
    expect(aggregate([trial("baseline", 1, [], {}, "other")]).aggregates.groups[0]?.durationMs).toBeUndefined()
  })

  it("leaves the pass rate delta out when a side has no graded trial, instead of a false ±100 pts", () => {
    const allOther = [trial("baseline", 1, [], {}, "other"), trial("with-sdlc", 1, [true], {}, "passed")]

    const [ablation] = aggregate(allOther).ablation

    expect(ablation).toBeDefined()
    expect(ablation?.passRate).toBeUndefined()
    expect(renderMarkdown({ ...report, results: { ...report.results, tests: allOther } })).toContain(
      "| review | with-sdlc | — | — | — | — |",
    )
  })

  it("counts a criterion left out by a closed gate neither as met nor as missed: one denominator per trial", () => {
    // pr379: a perfect "non" has 3 criteria (the judge is gated out), a perfect "oui" has 4.
    const perfect = (variant: string, n: number, count: number) =>
      trial(
        variant,
        n,
        Array.from({ length: count }, () => true),
        { ...(count === 4 && { score: 1 }) },
      )
    const mixed = aggregate([perfect("baseline", 1, 4), perfect("baseline", 2, 4), perfect("with-sdlc", 1, 3), perfect("with-sdlc", 2, 4)])
    const [baseline, withSdlc] = mixed.aggregates.groups

    expect(withSdlc?.criteria).toMatchObject({ mean: 1, sd: 0, n: 2 })
    expect(baseline?.criteria).toMatchObject({ mean: 1, sd: 0, n: 2 })
    expect(mixed.ablation[0]?.criteria).toBe(0)
    const markdown = renderMarkdown({
      ...report,
      results: { ...report.results, tests: [perfect("baseline", 1, 4), perfect("with-sdlc", 1, 3), perfect("with-sdlc", 2, 4)] },
    })
    expect(markdown).toContain("| review | with-sdlc | 2/2 | 100% ± 0 | 100% ± 0 | 2/2 |")
    expect(markdown).toContain("| review | with-sdlc | 0 pts |")
  })

  it("says over how many graded trials a score is averaged, when some have none", () => {
    const tests = [trial("baseline", 1, [true], { score: 0.5 }), trial("baseline", 2, [false], {}, "failed")]
    const [group] = aggregate(tests).aggregates.groups

    expect(group?.score).toMatchObject({ mean: 0.5, n: 1 })
    expect(renderMarkdown({ ...report, results: { ...report.results, tests } })).toContain("| 0.50 ± 0.00 (1/2) |")
    expect(renderHtml({ ...report, results: { ...report.results, tests } })).toContain("<dt>Score (0–1)</dt><dd>0.50 ± 0.00 (1/2)</dd>")
  })

  it("compares each variant with the baseline of the same case", () => {
    const { ablation } = aggregate(tests)

    expect(ablation).toEqual([
      {
        caseId: "review",
        variant: "with-sdlc",
        baseline: "baseline",
        criteria: 0.5,
        score: expect.closeTo(0.625),
        costUsd: expect.closeTo(0.8),
        passRate: 0.5,
      },
    ])
    expect(aggregate(tests, "with-sdlc").ablation.map((a) => a.variant)).toEqual(["baseline"])
    expect(aggregate(tests, "nope").ablation).toEqual([])
  })

  it("recomputes the aggregates of a report, against the run's baseline or another one", () => {
    expect(aggregatesOf(report)).toEqual(aggregate(tests))
    const stored = { ...report, results: { ...report.results, extra: { ...aggregate(tests, "with-sdlc") } } }
    expect(aggregatesOf(stored).aggregates.baseline).toBe("with-sdlc")
    expect(aggregatesOf(stored, "baseline")).toEqual(aggregate(tests))
  })
})
