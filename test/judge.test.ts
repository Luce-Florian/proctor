import { describe, expect, it } from "vitest"
import { judge, MAX_PROMPT_BYTES, runSuite, suite, toCtrf } from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { ctrfErrors } from "#test/ctrf-schema.ts"
import { fakeJudge, verdict } from "#test/graders.ts"

describe("judge()", () => {
  it("makes the trial other after 2 retries, with every raw answer in the trace", async () => {
    const runtime = fakeJudge('{"score": 9, "criteria": []}', "```json\nnot json\n```", '{"verdict": "ok"}')
    const definition = suite("s")
      .variant("v", (v) => v.prompt("p"))
      .case("c", (c) => c.expect(judge().criterion("a", "A")))
      .toDefinition()

    const run = await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox(), judge: runtime })

    const trial = run.trials[0]
    expect(runtime.calls).toHaveLength(3)
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(
      /grader judge failed: the judge gave no valid answer in 3 attempts .*\$0\.030 spent; raw answers are in the trial trace/,
    )
    expect(trial?.trace).toContain("--- judge attempt 1: ")
    expect(trial?.trace).toContain("not json")
    expect(trial?.trace).toContain('{"verdict": "ok"}')
  })

  it("keeps what the attempts cost when the judge run itself fails, without asking again", async () => {
    const runtime = fakeJudge("not json")
    const run = runtime.agent.run.bind(runtime.agent)
    let calls = 0
    runtime.agent.run = async (input, ws) => {
      calls += 1
      if (calls === 2) throw new Error("judge timed out")
      return run(input, ws)
    }
    const definition = suite("s")
      .variant("v", (v) => v.prompt("p"))
      .case("c", (c) => c.expect(judge().model("m").criterion("a", "A")))
      .toDefinition()

    const report = toCtrf(await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox(), judge: runtime }), {
      toolVersion: "0",
    })

    const test = report.results.tests[0]
    expect(calls).toBe(2)
    expect(test?.status).toBe("other")
    expect(test?.message).toContain("judge attempt 2 failed: judge timed out, $0.010 spent")
    expect(test?.trace).toContain("--- judge attempt 1: no JSON object found\nnot json")
    expect(test?.extra).toMatchObject({ judgeCalls: 1, judgeCostUsd: 0.01 })
    expect((report.results.extra?.aggregates as { judge: unknown }).judge).toEqual({ calls: 1, costUsd: 0.01 })
  })

  it("records the cut in the CTRF, next to the judge's cost", async () => {
    const runtime = fakeJudge(verdict(5, { a: true }))
    const definition = suite("s")
      .variant("v", (v) => v.prompt("p"))
      .case("c", (c) => c.expect(judge().model("m").criterion("a", "A")))
      .toDefinition()
    const agent = new FakeAgentAdapter({ reply: () => "x".repeat(MAX_PROMPT_BYTES + 10) })

    const report = toCtrf(await runSuite(definition, { agent, sandbox: new FakeSandbox(), judge: runtime }), { toolVersion: "0" })

    expect(report.results.tests[0]?.extra?.judgeTruncated).toMatchObject({ diffBytes: 0, answerBytes: expect.any(Number) })
    expect(ctrfErrors(report)).toEqual([])
  })

  it("reports the judge apart from the agent: environment, calls and cost per test, run totals", async () => {
    const runtime = { ...fakeJudge(verdict(5, { a: true })), model: "judge-model" }
    const definition = suite("s")
      .variant("baseline", (v) => v.prompt("p"))
      .case("c", (c) => c.expect(judge().criterion("a", "A")))
      .toDefinition()

    const report = toCtrf(
      await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox(), judge: runtime, repeat: 2 }),
      { toolVersion: "0" },
    )

    expect(ctrfErrors(report)).toEqual([])
    expect(report.results.environment?.extra?.judge).toEqual({
      id: "judge",
      version: "0.0.0",
      sandbox: { id: "fake", isolation: "none" },
      model: "judge-model",
    })
    expect(report.results.tests[0]?.extra).toMatchObject({
      costUsd: 0,
      judgeCalls: 1,
      judgeCostUsd: 0.01,
      judgeTokens: { inputTokens: 100, outputTokens: 10 },
    })
    expect((report.results.extra?.aggregates as { judge: unknown }).judge).toEqual({ calls: 2, costUsd: 0.02 })
  })
})
