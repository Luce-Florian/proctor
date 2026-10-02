// A review case over two variants, with verdicts, scores and costs as a CTRF report holds them:
// the input of the aggregates, the markdown summary and the HTML report.
import type { CtrfReport, CtrfTest } from "@fluce/proctor"

interface Verdict {
  id: string
  met: boolean
  principal?: boolean
  decoy?: boolean
  text?: string
  why?: string
}

/** Trial `n` of `variant`: one criterion per `met`, the first principal, the third a decoy. */
export const trial = (
  variant: string,
  n: number,
  met: boolean[],
  extra: Record<string, unknown> = {},
  status: CtrfTest["status"] = "passed",
): CtrfTest => ({
  name: `review [${variant}] #${n}`,
  status,
  duration: 1000 * n,
  suite: ["s", "review", variant],
  labels: { case: "review", variant, trial: n },
  extra: {
    criteria: met.map((m, i): Verdict => ({
      id: `c0${i + 1}`,
      met: m,
      ...(i === 0 && { principal: true }),
      ...(i === 2 && { decoy: true }),
    })),
    ...extra,
  },
})

export const tests: CtrfTest[] = [
  trial("baseline", 1, [true, false, true], { score: 0.5, costUsd: 0.3, judgeCalls: 1, judgeCostUsd: 0.05 }),
  trial("baseline", 2, [true, false, false], { score: 0.25, costUsd: 0.5, judgeCalls: 2, judgeCostUsd: 0.1 }, "failed"),
  trial("with-sdlc", 1, [true, true, true], { score: 1, costUsd: 1.2, judgeCalls: 1, judgeCostUsd: 0.05 }),
  trial("with-sdlc", 2, [], {}, "other"),
]

export const report: CtrfReport = {
  reportFormat: "CTRF",
  specVersion: "1.0.0",
  runId: "run-7",
  timestamp: "2026-09-30T10:00:00.000Z",
  results: {
    tool: { name: "proctor" },
    summary: { tests: 4, passed: 2, failed: 1, skipped: 0, pending: 0, other: 1, start: 0, stop: 60_000 },
    environment: {
      reportName: "s",
      extra: {
        agent: { id: "fake", version: "1" },
        sandbox: { id: "fake" },
        isolation: "none",
        judge: { id: "claude-code", version: "2.1.280", model: "claude-sonnet-5" },
      },
    },
    tests,
  },
}
