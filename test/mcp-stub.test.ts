import { describe, expect, it } from "vitest"
import { ConsoleReporter, mcpCalled, mcpError, mcpStub, regex, renderMarkdown, runSuite, suite, toCtrf } from "@fluce/proctor"
import { answerStub, FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"

const pgsql = mcpStub("pgsql").tool("get_object_details", (t) => t.otherwise(mcpError("relation does not exist")))

describe("MCP stubs", () => {
  it("hands the agent the stubs of its variant, with the rules of the case merged in", async () => {
    const definition = suite("sql-review")
      .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt("Review change.diff"))
      .variant("without-server", (v) => v.prompt("Review change.diff"))
      .case("index-exists", (c) =>
        c
          .mcpStub(pgsql, (s) => s.on("get_object_details", { object_name: "orders" }).returns({ table: "public.orders" }))
          .expect(regex("any-answer", /./)),
      )
      .toDefinition()
    const agent = new FakeAgentAdapter()

    await runSuite(definition, { agent, sandbox: new FakeSandbox() })

    expect(agent.calls.map((input) => input.mcpStubs)).toEqual([
      [
        {
          server: "pgsql",
          tools: [
            {
              name: "get_object_details",
              inputSchema: { type: "object" },
              rules: [
                { when: { object_name: "orders" }, answers: [{ content: { table: "public.orders" }, isError: false }], answeredBy: "case" },
              ],
              otherwise: { content: "relation does not exist", isError: true },
            },
          ],
        },
      ],
      [],
    ])
  })
})

describe("graded MCP stub calls", () => {
  /** An agent that reads orders, which the case anticipates, then customers, which only the fallback answers. */
  const agent = new FakeAgentAdapter({
    reply: (input) => ({
      finalText: "orders already has an index on customer_id",
      toolCalls:
        input.mcpStubs.length === 0
          ? []
          : [
              answerStub(input.mcpStubs, "pgsql", "get_object_details", { object_name: "orders" }),
              answerStub(input.mcpStubs, "pgsql", "get_object_details", { object_name: "customers" }),
            ],
    }),
  })
  const definition = suite("sql-review")
    .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt("Review change.diff"))
    .variant("without-server", (v) => v.prompt("Review change.diff"))
    .case("index-exists", (c) =>
      c
        .mcpStub(pgsql, (s) => s.on("get_object_details", { object_name: "orders" }).returns({ table: "public.orders" }))
        .expect(mcpCalled("reads-orders", pgsql, { tool: "get_object_details", input: { object_name: "orders" } }))
        .expect(mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 }))
        .expect(regex("answers", /index/)),
    )
    .toDefinition()

  it("grades the calls in the variant with the stub, and leaves its criteria out in the variant without it", async () => {
    const run = await runSuite(definition, { agent, sandbox: new FakeSandbox() })

    expect(run.trials.map((trial) => [trial.variant, trial.status, trial.message])).toEqual([
      ["with-pgsql", "failed", "Unmet criteria: all-anticipated"],
      ["without-server", "passed", undefined],
    ])
  })

  it("counts the stub calls in the CTRF, and notes the unanticipated ones in the summary", async () => {
    const report = toCtrf(await runSuite(definition, { agent, sandbox: new FakeSandbox() }), { toolVersion: "0.0.0" })

    expect(report.results.tests[0]?.extra).toMatchObject({ mcpStubCalls: 2, mcpStubFallbacks: 1 })
    expect(renderMarkdown(report)).toContain(
      "**Unanticipated MCP calls:** index-exists [with-pgsql] #1: 1 MCP stub call(s) answered by a fallback: " +
        "the agent asked something the case did not anticipate; the case may need a rule",
    )
  })
  it("notes in the console each trial where a fallback answered a stub call", async () => {
    const printed: string[] = []

    await runSuite(definition, {
      agent,
      sandbox: new FakeSandbox(),
      reporters: [new ConsoleReporter({ write: (line: string) => printed.push(line) })],
    })

    expect(printed).toContain(
      "      note: 1 MCP stub call(s) answered by a fallback: the agent asked something the case did not anticipate; the case may need a rule\n",
    )
  })
})
