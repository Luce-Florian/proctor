import { describe, expect, it } from "vitest"
import {
  exitCodeFor,
  InterruptedError,
  regex,
  runSuite,
  suite,
  type Reporter,
  type SandboxSpec,
  type TrialResult,
  type Workspace,
} from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"

const definition = suite("matrix")
  .variant("baseline", (v) => v.prompt((c) => `baseline ${c.id}`))
  .variant("with-plugin", (v) => v.prompt((c) => `plugin ${c.id}`).plugins("demo"))
  .case("first", (c) => c.expect(regex("any", /./)))
  .case("second", (c) => c.expect(regex("any", /./)))
  .toDefinition()

const label = (t: TrialResult) => `${t.caseId}/${t.variant}#${t.trial}`

describe("runSuite", () => {
  it("runs --repeat 3 -j 2 with at most 2 trials in parallel and keeps matrix order", async () => {
    // The first trial of the matrix only answers once another one has ended, so completion order differs from
    // matrix order whatever the machine load. Its workspace carries its label to recognise it.
    let releaseFirst = () => {}
    const anotherEnded = new Promise<void>((resolve) => (releaseFirst = resolve))
    const agent = new FakeAgentAdapter({
      reply: async (input, workspace) => {
        if (workspace.env.TRIAL === "first [baseline] #1") await anotherEnded
        return `echo: ${input.prompt}`
      },
    })
    const sandbox = new (class extends FakeSandbox {
      override async create(spec: SandboxSpec): Promise<Workspace> {
        return { ...(await super.create(spec)), env: { TRIAL: spec.label } }
      }
    })()
    const completed: string[] = []
    const reporter: Reporter = {
      onTrialEnd: (t) => {
        completed.push(label(t))
        releaseFirst()
      },
    }

    const run = await runSuite(definition, { agent, sandbox, repeat: 3, concurrency: 2, reporters: [reporter] })

    expect(run.trials.map(label)).toEqual([
      "first/baseline#1",
      "first/baseline#2",
      "first/baseline#3",
      "first/with-plugin#1",
      "first/with-plugin#2",
      "first/with-plugin#3",
      "second/baseline#1",
      "second/baseline#2",
      "second/baseline#3",
      "second/with-plugin#1",
      "second/with-plugin#2",
      "second/with-plugin#3",
    ])
    expect(agent.maxConcurrency).toBe(2)
    expect(completed).toHaveLength(12)
    expect(completed).not.toEqual(run.trials.map(label))
    expect(sandbox.live).toBe(0)
  })

  it("on interrupt, stops the running trial, cleans it up, starts no other, and still runs afterAll", async () => {
    const interrupt = new AbortController()
    const agent = new FakeAgentAdapter({ delayMs: 60_000 })
    const sandbox = new FakeSandbox()
    const events: string[] = []
    const withHooks = suite("interrupted")
      .variant("v", (v) => v.prompt("hi"))
      .case("first", (c) => c.expect(regex("any", /./)))
      .case("second", (c) => c.expect(regex("any", /./)))
      .afterAll(() => void events.push("afterAll"))
      .toDefinition()
    setTimeout(() => interrupt.abort(new InterruptedError("SIGINT")), 30)

    const started = Date.now()
    const run = await runSuite(withHooks, { agent, sandbox, signal: interrupt.signal })

    expect(Date.now() - started).toBeLessThan(5_000)
    expect(run.trials.map((t) => [t.status, t.message])).toEqual([
      ["other", "agent run failed: interrupted by SIGINT: cleanups ran, the remaining trials were not started"],
      ["other", "interrupted by SIGINT: cleanups ran, the remaining trials were not started"],
    ])
    expect(agent.calls).toHaveLength(1)
    expect(agent.calls[0]?.signal.aborted).toBe(true)
    expect(sandbox.live).toBe(0)
    expect(events).toEqual(["afterAll"])
    expect(exitCodeFor(run)).toBe(2)
  })

  it("hands each variant its own input", async () => {
    const agent = new FakeAgentAdapter()
    await runSuite(definition, { agent, sandbox: new FakeSandbox(), cases: ["first"] })

    expect(agent.calls.map((c) => [c.prompt, c.plugins])).toEqual([
      ["baseline first", []],
      ["plugin first", ["demo"]],
    ])
  })

  it("filters cases and variants", async () => {
    const run = await runSuite(definition, {
      agent: new FakeAgentAdapter(),
      sandbox: new FakeSandbox(),
      cases: ["second"],
      variants: ["with-plugin"],
    })

    expect(run.trials.map(label)).toEqual(["second/with-plugin#1"])
  })

  it("rejects an unknown case with the list of known ones", async () => {
    const run = runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox(), cases: ["nope"] })

    await expect(run).rejects.toThrow('Unknown case "nope" in suite "matrix". Known cases: first, second')
  })

  it("notifies reporters and records the environment", async () => {
    const calls: string[] = []
    const reporter: Reporter = {
      onRunStart: (info) => void calls.push(`start:${info.plannedTrials}`),
      onTrialEnd: () => void calls.push("trial"),
      onRunEnd: (run) => void calls.push(`end:${run.trials.length}`),
    }
    const run = await runSuite(definition, {
      agent: new FakeAgentAdapter({ version: "9.9.9" }),
      sandbox: new FakeSandbox(),
      reporters: [reporter],
      runId: "run-1",
      host: { commit: "abc123" },
    })

    expect(calls).toEqual(["start:4", "trial", "trial", "trial", "trial", "end:4"])
    expect(run.runId).toBe("run-1")
    expect(run.environment).toEqual({
      agent: { id: "fake", version: "9.9.9" },
      sandbox: { id: "fake", isolation: "none" },
      host: { commit: "abc123" },
    })
  })

  it("reports a failing afterAll as a suite error, after every trial ran", async () => {
    const failingAfterAll = suite("matrix")
      .afterAll(() => {
        throw new Error("cache cleanup failed")
      })
      .variant("baseline", (v) => v.prompt("hi"))
      .case("first", (c) => c.expect(regex("any", /./)))
      .toDefinition()
    const ended: string[][] = []
    const run = await runSuite(failingAfterAll, {
      agent: new FakeAgentAdapter(),
      sandbox: new FakeSandbox(),
      reporters: [{ onRunEnd: (r) => void ended.push([...r.suiteErrors]) }],
    })

    expect(run.trials.map((t) => t.status)).toEqual(["passed"])
    expect(run.suiteErrors).toEqual(["afterAll failed: cache cleanup failed"])
    expect(ended).toEqual([["afterAll failed: cache cleanup failed"]])
    expect(exitCodeFor(run)).toBe(2)
  })

  it("isolates a throwing reporter: every trial still runs before afterAll, and the error is a suite error", async () => {
    const events: string[] = []
    const withHooks = suite("matrix")
      .afterAll(() => void events.push("afterAll"))
      .variant("baseline", (v) => v.prompt("hi"))
      .case("first", (c) => c.expect(regex("any", /./)))
      .case("second", (c) => c.expect(regex("any", /./)))
      .toDefinition()
    const broken: Reporter = {
      onTrialEnd: (t) => {
        if (t.caseId === "first") throw new Error("disk full")
      },
    }
    const agent = new FakeAgentAdapter({ delayMs: 20, reply: () => (events.push("act"), "ok") })

    const run = await runSuite(withHooks, { agent, sandbox: new FakeSandbox(), concurrency: 2, repeat: 2, reporters: [broken] })

    expect(events).toEqual(["act", "act", "act", "act", "afterAll"])
    expect(run.trials.map((t) => t.status)).toEqual(["passed", "passed", "passed", "passed"])
    expect(run.suiteErrors).toEqual(["reporter onTrialEnd failed: disk full", "reporter onTrialEnd failed: disk full"])
    expect(exitCodeFor(run)).toBe(2)
  })

  it("rejects invalid options with an actionable message", async () => {
    const run = runSuite(definition, { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox(), repeat: 0 })

    await expect(run).rejects.toThrow(/Invalid run options:[\s\S]*>=1[\s\S]*repeat/)
  })
})
