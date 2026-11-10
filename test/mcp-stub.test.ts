import { describe, expect, it } from "vitest"
import { mcpError, mcpStub, regex, runSuite, suite } from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"

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
