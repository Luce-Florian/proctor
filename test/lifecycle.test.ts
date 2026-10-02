import { setTimeout as sleep } from "node:timers/promises"
import { describe, expect, it } from "vitest"
import { judge, regex, runSuite, suite, verdictEquals, verdictIs, type AgentAdapter, type GradeContext, type Grader } from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { recordingFixture, recordingGrader } from "#test/helpers.ts"

/** Runs a one-case, one-variant suite whose hooks, fixtures and grader all record into `events`. */
async function runRecorded(
  options: {
    agent?: AgentAdapter
    fixtures?: ReturnType<typeof recordingFixture>[]
    passed?: boolean
    timeout?: "50ms"
    beforeEach?: () => void
    events?: string[]
    /** Gives the grader a prepare step that records, or throws. */
    graderPrepare?: "record" | "throw"
  } = {},
) {
  const events = options.events ?? []
  const agent =
    options.agent ??
    new FakeAgentAdapter({
      reply: () => {
        events.push("act")
        return "hello"
      },
    })
  const sandbox = new FakeSandbox()
  const definition = suite("lifecycle")
    .beforeAll(() => void events.push("beforeAll"))
    .afterAll(() => void events.push("afterAll"))
    .variant("baseline", (v) =>
      v
        .prompt("hi")
        .beforeEach(() => {
          events.push("beforeEach")
          options.beforeEach?.()
        })
        .afterEach(() => void events.push("afterEach")),
    )
    .case("only", (c) => {
      const withFixtures = (options.fixtures ?? [recordingFixture(events)]).reduce((acc, f) => acc.fixture(f), c)
      const recorded = recordingGrader(events, options.passed ?? true)
      const mode = options.graderPrepare
      const grader: Grader = mode
        ? {
            ...recorded,
            prepare: async () => {
              if (mode === "throw") throw new Error("snapshot failed")
              events.push("grader prepare")
            },
          }
        : recorded
      const withGrader = withFixtures.expect(grader)
      return options.timeout ? withGrader.timeout(options.timeout) : withGrader
    })
    .toDefinition()
  const run = await runSuite(definition, { agent, sandbox })
  return { events, sandbox, run, trial: run.trials[0] }
}

describe("trial lifecycle", () => {
  it("runs hooks in xUnit order", async () => {
    const { events, trial } = await runRecorded()

    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "act", "assert", "afterEach", "teardown", "afterAll"])
    expect(trial?.status).toBe("passed")
  })

  it("prepares graders after beforeEach, right before act", async () => {
    const { events } = await runRecorded({ graderPrepare: "record" })

    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "grader prepare", "act", "assert", "afterEach", "teardown", "afterAll"])
  })

  it("reports other when a grader prepare throws, without running the agent, and still cleans up", async () => {
    const { events, sandbox, trial } = await runRecorded({ graderPrepare: "throw" })

    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "afterEach", "teardown", "afterAll"])
    expect(sandbox.live).toBe(0)
    expect(trial).toMatchObject({ status: "other", message: expect.stringContaining("grader recorded prepare failed: snapshot failed") })
  })

  it("still tears down when act throws, and reports other", async () => {
    const agent = new FakeAgentAdapter({
      reply: () => {
        throw new Error("agent crashed")
      },
    })
    const { events, sandbox, trial } = await runRecorded({ agent })

    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "afterEach", "teardown", "afterAll"])
    expect(sandbox.destroyed).toHaveLength(1)
    expect(sandbox.live).toBe(0)
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(/agent crashed/)
    expect(trial?.trace).toMatch(/Error: agent crashed/)
  })

  it("still tears down when act times out, and reports other", async () => {
    const agent = new FakeAgentAdapter({ delayMs: 10_000 })
    const started = Date.now()
    const { events, sandbox, trial } = await runRecorded({ agent, timeout: "50ms" })

    expect(Date.now() - started).toBeLessThan(5_000)
    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "afterEach", "teardown", "afterAll"])
    expect(sandbox.live).toBe(0)
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(/timed out after 50ms: raise the case \.timeout\(\.\.\.\)/)
    expect(agent.calls[0]?.signal.aborted).toBe(true)
  })

  it("waits for an agent that ignores the abort before cleaning up", async () => {
    const events: string[] = []
    const stubborn: AgentAdapter = {
      id: "stubborn",
      version: async () => "0.0.0",
      run: async () => {
        await sleep(150)
        events.push("act-end")
        return { finalText: "hello", durationMs: 150, turns: 1, toolCalls: [] }
      },
    }
    const { trial } = await runRecorded({ events, agent: stubborn, timeout: "50ms", fixtures: [recordingFixture(events)] })

    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "act-end", "afterEach", "teardown", "afterAll"])
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(/timed out after 50ms/)
  })

  it("still runs afterEach, teardown and sandbox.destroy when beforeEach throws", async () => {
    const { events, sandbox, trial } = await runRecorded({
      beforeEach: () => {
        throw new Error("plugin install failed")
      },
    })

    expect(events).toEqual(["beforeAll", "setup", "beforeEach", "afterEach", "teardown", "afterAll"])
    expect(sandbox.live).toBe(0)
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(/beforeEach failed: plugin install failed/)
  })

  it("tears fixtures down in reverse order of setup", async () => {
    const events: string[] = []
    const fixtures = ["a", "b", "c"].map((label) => recordingFixture(events, label))
    await runRecorded({ fixtures })

    expect(events).toEqual(["setup:a", "setup:b", "setup:c", "teardown:c", "teardown:b", "teardown:a"])
  })

  it("tears down only what was set up when a fixture fails", async () => {
    const events: string[] = []
    const fixtures = [recordingFixture(events, "a"), recordingFixture(events, "b", { failOnSetup: true })]
    const { sandbox, trial } = await runRecorded({ fixtures })

    expect(events).toEqual(["setup:a", "teardown:a"])
    expect(sandbox.live).toBe(0)
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(/setup:b exploded/)
  })

  it("reports other when a teardown fails, and still destroys the sandbox", async () => {
    const events: string[] = []
    const fixtures = [recordingFixture(events, "a"), recordingFixture(events, "b", { failOnTeardown: true })]
    const { sandbox, trial } = await runRecorded({ fixtures })

    expect(events).toEqual(["setup:a", "setup:b", "teardown:b", "teardown:a"])
    expect(sandbox.live).toBe(0)
    expect(trial?.status).toBe("other")
    expect(trial?.message).toMatch(/teardown:b exploded/)
  })

  it("reports failed when a grader does not pass", async () => {
    const { trial } = await runRecorded({ passed: false })

    expect(trial?.status).toBe("failed")
    expect(trial?.message).toBe("Unmet criteria: recorded")
  })

  it("fails a trial whose grader passes but misses a principal criterion", async () => {
    const lenient: Grader = {
      id: "lenient",
      grade: async () => ({
        graderId: "lenient",
        passed: true,
        score: 0.9,
        criteria: [
          { id: "date-filter-inverted", met: false, principal: true },
          { id: "naming", met: true },
        ],
      }),
    }
    const definition = suite("lifecycle")
      .variant("baseline", (v) => v.prompt("hi"))
      .case("only", (c) => c.expect(lenient))
      .toDefinition()
    const run = await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox() })

    expect(run.trials[0]).toMatchObject({ status: "failed", message: "Unmet criteria: date-filter-inverted (principal)" })
  })

  it("reports other, not passed, when every grader left its criteria out: nothing was graded", async () => {
    const definition = suite("lifecycle")
      .variant("baseline", (v) => v.prompt("hi"))
      .case("gated", (c) =>
        c.expect(judge().criterion("ddl", "Une ligne identifie une migration", { principal: true }).when(verdictIs("yes"))),
      )
      .case("kept", (c) => c.expect(verdictEquals("verdict", ["no", "yes"])).expect(judge().criterion("ddl", "…").when(verdictIs("yes"))))
      .toDefinition()
    const run = await runSuite(definition, { agent: new FakeAgentAdapter({ reply: () => "non" }), sandbox: new FakeSandbox() })

    expect(run.trials.map((t) => [t.caseId, t.status, t.message])).toEqual([
      [
        "gated",
        "other",
        "Nothing was graded: every grader left its criteria out (a closed .when() gate?); keep one outside the gate, e.g. verdictEquals",
      ],
      ["kept", "passed", undefined],
    ])
  })

  it("reports other when a grader throws", async () => {
    const definition = suite("lifecycle")
      .variant("baseline", (v) => v.prompt("hi"))
      .case("only", (c) =>
        c.expect({
          id: "broken",
          grade: () => Promise.reject(new Error("judge unreachable")),
        }),
      )
      .toDefinition()
    const run = await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox() })

    expect(run.trials[0]?.status).toBe("other")
    expect(run.trials[0]?.message).toMatch(/judge unreachable/)
  })

  it("reports skipped cases without creating a sandbox", async () => {
    const sandbox = new FakeSandbox()
    const definition = suite("lifecycle")
      .variant("baseline", (v) => v.prompt("hi"))
      .case("later", (c) => c.skip("not ready"))
      .toDefinition()
    const run = await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox })

    expect(run.trials[0]).toMatchObject({ status: "skipped", message: "not ready" })
    expect(sandbox.created).toHaveLength(0)
  })

  it("marks every trial other when beforeAll fails, and still runs afterAll", async () => {
    const events: string[] = []
    const agent = new FakeAgentAdapter()
    const definition = suite("lifecycle")
      .beforeAll(() => {
        throw new Error("image build failed")
      })
      .afterAll(() => void events.push("afterAll"))
      .variant("baseline", (v) => v.prompt("hi"))
      .case("only", (c) => c.expect(regex("any", /./)))
      .toDefinition()
    const run = await runSuite(definition, { agent, sandbox: new FakeSandbox(), repeat: 2 })

    expect(run.trials.map((t) => t.status)).toEqual(["other", "other"])
    expect(run.trials[0]?.message).toMatch(/beforeAll failed: image build failed/)
    expect(agent.calls).toHaveLength(0)
    expect(events).toEqual(["afterAll"])
  })

  it("keeps skipped cases skipped when beforeAll fails", async () => {
    const definition = suite("lifecycle")
      .beforeAll(() => {
        throw new Error("image build failed")
      })
      .variant("baseline", (v) => v.prompt("hi"))
      .case("runs", (c) => c.expect(regex("any", /./)))
      .case("later", (c) => c.skip("not ready"))
      .toDefinition()
    const run = await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox() })

    expect(run.trials.map((t) => [t.status, t.message])).toEqual([
      ["other", "beforeAll failed: image build failed"],
      ["skipped", "not ready"],
    ])
  })
})

describe("agent preparation and sandbox access", () => {
  /** A fake agent that records prepare() and its undo, with sandbox needs of its own. */
  class PreparingAgent extends FakeAgentAdapter {
    readonly sandboxAccess = { allowedDomains: ["api.example.com"], readablePaths: ["/opt/agent"] }
    constructor(readonly events: string[]) {
      super({ reply: () => (events.push("act"), "hello") })
    }
    async prepare(input: { plugins: readonly string[] }) {
      this.events.push(`prepare ${input.plugins.join(",")}`)
      return async () => void this.events.push("prepare undo")
    }
  }

  it("prepares the agent after fixtures and before beforeEach, and undoes it after afterEach", async () => {
    const events: string[] = []
    const { trial } = await runRecorded({ agent: new PreparingAgent(events), events })

    expect(trial?.status).toBe("passed")
    expect(events).toEqual([
      "beforeAll",
      "setup",
      "prepare ",
      "beforeEach",
      "act",
      "assert",
      "afterEach",
      "prepare undo",
      "teardown",
      "afterAll",
    ])
  })

  it("hands the sandbox what the agent and the suite need, and graders the run's judge, never the agent under test", async () => {
    const sandbox = new FakeSandbox()
    const seen: GradeContext[] = []
    const grader: Grader = { id: "g", grade: async (c) => (seen.push(c), { graderId: "g", passed: true, criteria: [] }) }
    const agent = new PreparingAgent([])
    const definition = suite("access")
      .allowDomains("github.com", "api.example.com")
      .allowRead("/opt/hooks")
      .allowWrite("/tmp/.dotnet")
      .variant("v", (v) => v.prompt("hi").plugins("/p"))
      .case("c", (c) => c.expect(grader))
      .toDefinition()

    const judge = { agent: new FakeAgentAdapter({ id: "judge" }), sandbox: new FakeSandbox(), model: "judge-model" }
    await runSuite(definition, { agent, sandbox, judge })

    expect(sandbox.specs[0]?.access).toEqual({
      allowedDomains: ["api.example.com", "github.com"],
      readablePaths: ["/opt/agent", "/opt/hooks"],
      writablePaths: ["/tmp/.dotnet"],
    })
    expect(seen[0]?.judge).toBe(judge)
    expect(seen[0]).toMatchObject({ caseId: "c", variant: "v", trial: 1 })
    expect(seen[0]?.signal.aborted).toBe(false)
  })

  it("rejects a suite domain or readable path that is not one", () => {
    expect(() =>
      suite("x")
        .allowDomains("https://x.com")
        .allowRead("relative")
        .allowWrite("tmp")
        .variant("v", (v) => v.prompt("p"))
        .case("c", (c) => c.skip())
        .toDefinition(),
    ).toThrow(/expected a domain, e\.g\. github\.com[\s\S]*expected an absolute path[\s\S]*expected an absolute path/)
  })
})
