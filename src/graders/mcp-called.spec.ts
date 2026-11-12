import { describe, expect, it } from "vitest"
import { mcpStub } from "../dsl/mcp-stub.ts"
import type { ToolCall } from "../ports/agent.ts"
import { mcpCalled } from "./mcp-called.ts"
import { gradeContext } from "#test/helpers.ts"

const pgsql = mcpStub("pgsql")
  .tool("get_object_details", (t) => t.returns({}))
  .tool("execute_sql", (t) => t.returns([]))

/** What the agent called in a trial with pgsql: orders read by a case rule, customers by the fallback, a SQL query. */
const toolCalls: ToolCall[] = [
  {
    name: "mcp__pgsql__get_object_details",
    input: { object_name: "public.orders" },
    mcp: { server: "pgsql", tool: "get_object_details", answeredBy: "case" },
  },
  {
    name: "mcp__pgsql__get_object_details",
    input: { object_name: "customers" },
    mcp: { server: "pgsql", tool: "get_object_details", answeredBy: "fallback" },
  },
  {
    name: "mcp__pgsql__execute_sql",
    input: { sql: "select reltuples from pg_class" },
    mcp: { server: "pgsql", tool: "execute_sql", answeredBy: "stub" },
  },
  { name: "Read", input: { file_path: "change.diff" } },
]
const withPgsql = gradeContext({ toolCalls }, { mcpStubs: ["pgsql"] })

describe("mcpCalled", () => {
  it("counts the calls of a tool whose input matches the pattern a stub rule would use", async () => {
    const readsOrders = mcpCalled("reads-orders", pgsql, { tool: "get_object_details", input: { object_name: /^(public\.)?orders$/ } })

    expect((await readsOrders.grade(withPgsql)).criteria).toEqual([
      {
        id: "reads-orders",
        met: true,
        why: '1 pgsql get_object_details {"object_name":"/^(public\\\\.)?orders$/"} call(s), expected at least 1',
      },
    ])
  })

  it("fails when a fallback answered a call the case did not anticipate", async () => {
    const allAnticipated = mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 })

    expect(await allAnticipated.grade(withPgsql)).toEqual({
      graderId: "all-anticipated",
      passed: false,
      criteria: [{ id: "all-anticipated", met: false, why: "1 pgsql answered by fallback call(s), expected exactly 0" }],
    })
  })

  it("is not applicable in a trial whose variant runs without the stub", async () => {
    const readsOrders = mcpCalled("reads-orders", pgsql, { tool: "get_object_details" })

    expect(await readsOrders.grade(gradeContext({ toolCalls: [] }, { mcpStubs: [] }))).toEqual({
      graderId: "reads-orders",
      passed: true,
      criteria: [],
    })
  })
})
