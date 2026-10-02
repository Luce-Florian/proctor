import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { CtrfReport, CtrfTest } from "./ctrf-types.ts"
import { markdownSummary, renderMarkdown, summaryPath } from "./markdown.ts"
import { tempDir } from "#test/helpers.ts"
import { report as aggregatedReport, tests } from "#test/reports.ts"

const report: CtrfReport = {
  reportFormat: "CTRF",
  specVersion: "1.0.0",
  runId: "run-42",
  timestamp: "2026-09-30T10:00:00.000Z",
  generatedBy: "proctor",
  results: {
    tool: { name: "proctor", version: "0.1.0" },
    summary: { tests: 2, passed: 1, failed: 1, skipped: 0, pending: 0, other: 0, start: 0, stop: 1500 },
    environment: {
      reportName: "demo",
      commit: "abc123",
      extra: { agent: { id: "fake", version: "1.2.3" }, sandbox: { id: "fake" }, isolation: "none" },
    },
    tests: [
      {
        name: "greets [baseline] #1",
        status: "passed",
        duration: 1200,
        suite: ["demo", "greets", "baseline"],
        labels: { trial: 1 },
        extra: {
          criteria: [
            { id: "a", met: true },
            { id: "b", met: true },
          ],
          costUsd: 0.5,
        },
      },
      {
        name: "greets [with-plugin] #1",
        status: "failed",
        duration: 300,
        suite: ["demo", "greets", "with-plugin"],
        message: "Unmet criteria: b | c",
        labels: { trial: 1 },
        extra: {
          criteria: [
            { id: "a", met: true },
            { id: "b", met: false },
          ],
        },
      },
    ],
  },
}

describe("renderMarkdown", () => {
  const markdown = renderMarkdown(report)

  it("titles the run and its provenance", () => {
    expect(markdown).toContain("# demo — run-42")
    expect(markdown).toContain("2026-09-30T10:00:00.000Z · commit `abc123` · agent `fake` 1.2.3 · sandbox `fake` (isolation `none`)")
  })

  it("summarises statuses", () => {
    expect(markdown).toContain("| 2 | 1 | 1 | 0 | 0 | 1.5s |")
  })

  it("lists one row per trial, escaping pipes", () => {
    expect(markdown).toContain("| greets | baseline | 1 | passed | 2/2 | $0.500 | 1.2s |  |")
    expect(markdown).toContain("| greets | with-plugin | 1 | failed | 1/2 | — | 0.3s | Unmet criteria: b \\| c |")
  })
})

describe("markdownSummary", () => {
  it("writes <runId>.summary.md next to the CTRF file, one per run", async () => {
    const dir = await tempDir()
    const path = await markdownSummary(report, join(dir, "run-42.ctrf.json"))

    expect(path).toBe(join(dir, "run-42.summary.md"))
    expect(await readFile(path, "utf8")).toBe(renderMarkdown(report))
  })

  it("derives the summary path from the CTRF path", () => {
    expect(summaryPath("results/hello/run-1.ctrf.json")).toBe("results/hello/run-1.summary.md")
    expect(summaryPath("archive/report.json")).toBe("archive/report.summary.md")
  })

  it("shows suite errors", () => {
    const withError = { ...report, results: { ...report.results, extra: { suiteErrors: ["afterAll failed: boom"] } } }
    expect(renderMarkdown(withError)).toContain("**Suite error:** afterAll failed: boom")
  })
})

describe("markdown summary", () => {
  const report = aggregatedReport

  it("shows aggregates, the judge apart and the delta vs baseline", () => {
    const markdown = renderMarkdown(report)

    expect(markdown).toContain("judge `claude-code` 2.1.280 `claude-sonnet-5`")
    expect(markdown).toContain("| review | baseline | 1/2 | 50% ± 24 | 50% ± 71 | 2/2 | 0.38 ± 0.18 | $0.400 ± 0.141 | 3 × $0.150 |")
    expect(markdown).toContain("Judge: 4 call(s), $0.200, not counted in the costs above.")
    expect(markdown).toContain("## Ablation vs `baseline`")
    expect(markdown).toContain("| review | with-sdlc | +50 pts | +0.63 | +$0.800 | +50 pts |")
  })

  it("keeps a markdown row on one line whatever the line endings of a message", () => {
    const crlf = renderMarkdown({ ...report, results: { ...report.results, tests: [{ ...tests[0], message: "a\r\nb\rc" } as CtrfTest] } })
    expect(crlf).toContain("| a b c |")
  })
})
