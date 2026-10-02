import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { runSuite } from "../core/orchestrator.ts"
import { suite } from "../dsl/suite.ts"
import { regex } from "../graders/regex.ts"
import { AgentRunError } from "../ports/agent.ts"
import { CtrfReporter, ctrfPath, toCtrf } from "./ctrf.ts"
import type { CtrfReport } from "./ctrf-types.ts"
import { ctrfErrors } from "#test/ctrf-schema.ts"
import { tempDir } from "#test/helpers.ts"

/** One trial of each status: passed, failed, other, skipped. */
const mixed = suite("mixed")
  .variant("baseline", (v) => v.prompt((c) => c.context))
  .case("passes", (c) => c.context("hello").expect(regex("says-hello", /hello/)))
  .case("fails", (c) => c.context("bye").expect(regex("says-hello", /hello/)))
  .case("crashes", (c) => c.context("crash").expect(regex("says-hello", /hello/)))
  .case("later", (c) => c.skip("not ready"))
  .toDefinition()

const agent = new FakeAgentAdapter({
  version: "1.2.3",
  reply: ({ prompt }) => {
    if (prompt === "crash") throw new AgentRunError(new Error("agent crashed"), "results/transcripts/crash.jsonl")
    return prompt
  },
})

const run = await runSuite(mixed, {
  agent,
  sandbox: new FakeSandbox(),
  runId: "run-42",
  host: { commit: "abc123", branch: "main", osPlatform: "darwin", osRelease: "25.2.0" },
})
const report = toCtrf(run, { toolVersion: "0.1.0" })

describe("toCtrf", () => {
  it("produces a document valid against the official CTRF schema", () => {
    expect(ctrfErrors(report)).toEqual([])
  })

  it("maps one trial to one test, with the case > variant hierarchy as suite", () => {
    expect(report.results.tests.map((t) => [t.name, t.status, t.suite])).toEqual([
      ["passes [baseline] #1", "passed", ["mixed", "passes", "baseline"]],
      ["fails [baseline] #1", "failed", ["mixed", "fails", "baseline"]],
      ["crashes [baseline] #1", "other", ["mixed", "crashes", "baseline"]],
      ["later [baseline] #1", "skipped", ["mixed", "later", "baseline"]],
    ])
    expect(report.results.tests[1]?.message).toBe("Unmet criteria: says-hello")
    expect(report.results.tests[2]?.message).toMatch(/agent crashed/)
    expect(report.results.tests[2]?.trace).toMatch(/Error: agent crashed/)
  })

  it("points a failed run at the transcript the agent kept", () => {
    expect(report.results.tests[2]?.extra?.transcript).toBe("results/transcripts/crash.jsonl")
  })

  it("counts statuses in the summary", () => {
    expect(report.results.summary).toMatchObject({ tests: 4, passed: 1, failed: 1, other: 1, skipped: 1, pending: 0, suites: 1 })
  })

  it("keeps criteria and agent metrics in extra", () => {
    expect(report.results.tests[0]?.labels).toEqual({ case: "passes", variant: "baseline", trial: 1 })
    expect(report.results.tests[0]?.extra).toMatchObject({
      criteria: [{ id: "says-hello", met: true, grader: "says-hello" }],
      costUsd: 0,
      turns: 1,
    })
  })

  it("records the run, the tool and the environment", () => {
    expect(report).toMatchObject({ reportFormat: "CTRF", specVersion: "1.0.0", runId: "run-42", generatedBy: "proctor" })
    expect(report.results.tool).toEqual({ name: "proctor", version: "0.1.0" })
    expect(report.results.environment).toEqual({
      reportName: "mixed",
      commit: "abc123",
      branchName: "main",
      osPlatform: "darwin",
      osRelease: "25.2.0",
      extra: { agent: { id: "fake", version: "1.2.3" }, sandbox: { id: "fake" }, isolation: "none" },
    })
  })
})

describe("CtrfReporter", () => {
  it("writes results/<suite>/<runId>.ctrf.json, hands it to sinks and lists the files written", async () => {
    const outDir = await tempDir()
    const file = join(outDir, "mixed", "run-42.ctrf.json")
    const sunk: [CtrfReport, string][] = []
    const sink = async (report: CtrfReport, ctrfFile: string) => {
      sunk.push([report, ctrfFile])
      return `${ctrfFile}.derived`
    }
    const reporter = new CtrfReporter({ outDir, toolVersion: "0.1.0", sinks: [sink] })
    await reporter.onRunEnd(run)

    const written = JSON.parse(await readFile(file, "utf8")) as unknown
    expect(ctrfPath(outDir, run)).toBe(file)
    expect(ctrfErrors(written)).toEqual([])
    expect(sunk).toEqual([[written, file]])
    expect(reporter.written).toEqual([file, `${file}.derived`])
  })

  it("keeps suite errors in results.extra, still valid", () => {
    const withError = toCtrf({ ...run, suiteErrors: ["afterAll failed: boom"] }, { toolVersion: "0.1.0" })

    expect(withError.results.extra).toMatchObject({ suiteErrors: ["afterAll failed: boom"] })
    expect(ctrfErrors(withError)).toEqual([])
  })
})
