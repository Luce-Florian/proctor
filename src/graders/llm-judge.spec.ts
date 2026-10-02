import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { suite } from "../dsl/suite.ts"
import { judge } from "./llm-judge.ts"
import { verdictIs } from "./verdict-equals.ts"
import { fakeJudge, verdict } from "#test/graders.ts"
import { gradeContext, tempDir } from "#test/helpers.ts"

const review = judge()
  .model("claude-sonnet-5")
  .criterion("date-filter", "Flags the inverted filter", { principal: true })
  .criterion("offset", "Signale la pagination par offset")
  .decoy("async-suffix", "Aucun constat sur le suffixe Async")

describe("judge()", () => {
  it("asks the run's judge, never the agent under test: readonly, own sandbox, no plugin, pinned model", async () => {
    const judgeRuntime = fakeJudge(verdict(4, { "date-filter": true, offset: true, "async-suffix": true }))

    await review.grade(gradeContext({ finalText: "review text" }, { judge: judgeRuntime }))

    expect(judgeRuntime.calls[0]).toMatchObject({
      permissions: "readonly",
      model: "claude-sonnet-5",
      plugins: [],
      mcpServers: {},
      settings: {},
    })
    expect(judgeRuntime.calls[0]?.prompt).toContain('{"id":"date-filter","type":"principal","text":"Flags the inverted filter"}')
    expect(judgeRuntime.calls[0]?.prompt).toContain('{"id":"async-suffix","type":"decoy"')
    expect(judgeRuntime.calls[0]?.prompt).toMatch(/<<<BEGIN ([0-9a-f]{24})>>>\nreview text\n<<<END \1>>>/)
    expect(judgeRuntime.sandbox.specs[0]?.label).toBe("c [v] #1 judge")
    expect(judgeRuntime.sandbox.live).toBe(0)
  })

  it("uses --judge-model when the suite pins none, and the suite's model otherwise", async () => {
    const answer = verdict(5, { a: true })
    const runtime = { ...fakeJudge(answer), model: "cli-model" }

    await judge()
      .criterion("a", "A")
      .grade(gradeContext({}, { judge: runtime }))
    await judge()
      .model("suite-model")
      .criterion("a", "A")
      .grade(gradeContext({}, { judge: runtime }))

    expect(runtime.calls.map((c) => c.model)).toEqual(["cli-model", "suite-model"])
  })

  it("matches verdicts by id: shuffling the answer changes nothing, decoys keep their flag", async () => {
    const inOrder = verdict(3, { "date-filter": true, offset: false, "async-suffix": true })
    const shuffled = verdict(3, { "async-suffix": true, offset: false, "date-filter": true })

    const a = await review.grade(gradeContext({}, { judge: fakeJudge(inOrder) }))
    const b = await review.grade(gradeContext({}, { judge: fakeJudge(shuffled) }))

    expect(b.criteria).toEqual(a.criteria)
    expect(a).toMatchObject({ graderId: "judge", passed: true, score: 0.5 })
    expect(a.criteria).toEqual([
      { id: "date-filter", met: true, why: "date-filter ok", text: "Flags the inverted filter", principal: true },
      { id: "offset", met: false, why: "offset absent", text: "Signale la pagination par offset" },
      { id: "async-suffix", met: true, why: "async-suffix ok", text: "Aucun constat sur le suffixe Async", decoy: true },
    ])
  })

  it("caps a score that breaks the prompt's rules: 4 with a criterion missed, 2 with the principal missed", async () => {
    const grade = (met: Record<string, boolean>) => review.grade(gradeContext({}, { judge: fakeJudge(verdict(5, met)) }))

    expect((await grade({ "date-filter": true, offset: false, "async-suffix": true })).score).toBe(0.75)
    expect((await grade({ "date-filter": false, offset: true, "async-suffix": true })).score).toBe(0.25)
    expect((await grade({ "date-filter": true, offset: true, "async-suffix": true })).score).toBe(1)
  })

  it("asks again after an invalid answer, saying what was wrong, and sums the cost of every attempt", async () => {
    const runtime = fakeJudge(
      "I think it is fine",
      verdict(5, { "date-filter": true, offset: true }),
      verdict(5, { "date-filter": true, offset: true, "async-suffix": true }),
    )

    const grade = await review.grade(gradeContext({}, { judge: runtime }))

    expect(runtime.calls).toHaveLength(3)
    expect(runtime.calls[1]?.prompt).toContain("Your previous answer was invalid (no JSON object found)")
    expect(runtime.calls[2]?.prompt).toContain('missing criterion ids: "async-suffix"')
    expect(grade.passed).toBe(true)
    expect(grade.judgeUsage).toMatchObject({ calls: 3, tokens: { inputTokens: 300, outputTokens: 30 } })
    expect(grade.judgeUsage?.costUsd).toBeCloseTo(0.03)
  })

  it("passes from .minScore(), which must be an integer from 1 to 5", async () => {
    const answer = verdict(3, { a: true })

    expect(
      (
        await judge()
          .criterion("a", "A")
          .grade(gradeContext({}, { judge: fakeJudge(answer) }))
      ).passed,
    ).toBe(true)
    expect(
      (
        await judge()
          .minScore(4)
          .criterion("a", "A")
          .grade(gradeContext({}, { judge: fakeJudge(answer) }))
      ).passed,
    ).toBe(false)
    expect(() => judge().minScore(0)).toThrow("minScore must be an integer from 1 to 5, got 0.")
    expect(() => judge().minScore(2.5)).toThrow("minScore must be an integer from 1 to 5, got 2.5.")
  })

  it("asks only when its .when() gate holds: closed, no call and no criterion, so nothing counts against the trial", async () => {
    const gated = judge().criterion("c03", "Une ligne identifie une migration DDL", { principal: true }).when(verdictIs("yes"))
    const runtime = fakeJudge(verdict(5, { c03: true }))

    const closed = await gated.grade(gradeContext({ finalText: "non" }, { judge: runtime }))
    expect(runtime.calls).toHaveLength(0)
    expect(closed).toEqual({ graderId: "judge", passed: true, criteria: [] })

    const open = await gated.grade(gradeContext({ finalText: "oui\n- migration DDL" }, { judge: runtime }))
    expect(runtime.calls).toHaveLength(1)
    expect(open).toMatchObject({ passed: true, criteria: [{ id: "c03", met: true, principal: true }], judgeUsage: { calls: 1 } })
    expect(gated.usesJudge).toEqual({})
  })

  it("passes exactly when every criterion is met once they are all principal and minScore is 1, whatever the score", async () => {
    const all = judge().minScore(1).criterion("a", "A", { principal: true }).criterion("b", "B", { principal: true })
    const grade = async (score: number, met: Record<string, boolean>) =>
      (await all.grade(gradeContext({}, { judge: fakeJudge(verdict(score, met)) }))).passed

    expect(await grade(1, { a: true, b: true })).toBe(true)
    expect(await grade(5, { a: true, b: false })).toBe(false)
  })

  it("records an unpinned judge model as such: the score may move with the agent's default", async () => {
    const runtime = fakeJudge(verdict(5, { a: true }))
    const answered = runtime.agent.run.bind(runtime.agent)
    runtime.agent.run = async (input, ws) => ({ ...(await answered(input, ws)), model: "default-model" })

    const unpinned = await judge()
      .criterion("a", "A")
      .grade(gradeContext({}, { judge: runtime }))
    const pinned = await judge()
      .model("m")
      .criterion("a", "A")
      .grade(gradeContext({}, { judge: runtime }))

    expect(runtime.calls[0]?.model).toBeUndefined()
    expect(unpinned.judgeUsage?.model).toBe("unpinned (default-model)")
    expect(pinned.judgeUsage?.model).toBe("default-model")
    expect(judge().criterion("a", "A").usesJudge).toEqual({})
    expect(judge().model("m").criterion("a", "A").usesJudge).toEqual({ model: "m" })
  })

  it("sends the case diff as untrusted data, and says so when it cannot read it", async () => {
    const dir = await tempDir()
    const diff = join(dir, "x.diff")
    await writeFile(diff, "diff --git a/f b/f\n+changed line\n")
    const runtime = fakeJudge(verdict(5, { a: true }))

    await judge()
      .diff(diff)
      .criterion("a", "A")
      .grade(gradeContext({ finalText: "t" }, { judge: runtime }))

    expect(runtime.calls[0]?.prompt).toMatch(
      /Diff the agent worked on, between the lines <<<BEGIN (\w+)>>> and <<<END \1>>>:\n<<<BEGIN \1>>>\ndiff --git a\/f b\/f\n\+changed line\n<<<END \1>>>/,
    )
    await expect(
      judge()
        .diff(join(dir, "missing.diff"))
        .criterion("a", "A")
        .grade(gradeContext({}, { judge: runtime })),
    ).rejects.toThrow("judge() cannot read its diff")
  })

  it("says how to get a judge when the run has none, and rejects a duplicate id", async () => {
    await expect(review.grade(gradeContext({}))).rejects.toThrow("judge() needs a judge agent: run with --judge-agent <id>")
    expect(() => review.criterion("offset", "again")).toThrow('judge() criterion "offset" is declared twice.')
  })

  it("stops the judge with the run", async () => {
    const runtime = fakeJudge(verdict(5, { a: true }))
    const interrupt = new AbortController()

    await judge()
      .criterion("a", "A")
      .grade(gradeContext({}, { judge: runtime, signal: interrupt.signal }))
    interrupt.abort()

    expect(runtime.calls[0]?.signal.aborted).toBe(true)
  })
})

describe("narrowing types", () => {
  it("does not accept a judge or limits without anything to check", () => {
    const build = () =>
      suite("s")
        .variant("v", (v) => v.prompt("p"))
        // @ts-expect-error judge() without criterion is not a grader
        .case("no-criterion", (c) => c.expect(judge().model("m")))
    expect(build).toBeTypeOf("function")
  })
})
