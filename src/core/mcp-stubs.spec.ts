import { describe, expect, it } from "vitest"
import { stubsFor } from "./mcp-stubs.ts"
import type { McpCaseRules } from "./model.ts"
import { stub, stubTool } from "#test/mcp-stubs.ts"

const ordersDetails = { content: { table: "public.orders" }, isError: false }
const noRelation = { content: "relation does not exist", isError: true }
const timeout = { content: "timeout", isError: true }

/** A pgsql stub whose get_object_details answers "relation does not exist" to any input, in every case. */
const pgsql = stub("pgsql", stubTool("get_object_details", { rules: [{ answers: [noRelation], answeredBy: "stub" }] }))

describe("stubsFor", () => {
  it("puts the case rules of a tool before the stub's own, in the order the case declared them, tagged as the case's", () => {
    const mcpStubRules: McpCaseRules[] = [
      { server: "pgsql", rules: [{ tool: "get_object_details", when: { object_name: "orders" }, answers: [ordersDetails] }] },
      { server: "pgsql", rules: [{ tool: "get_object_details", answers: [timeout] }] },
    ]

    const [merged] = stubsFor({ mcpStubs: [pgsql] }, { mcpStubRules })

    expect(merged?.tools[0]?.rules).toEqual([
      { when: { object_name: "orders" }, answers: [ordersDetails], answeredBy: "case" },
      { answers: [timeout], answeredBy: "case" },
      { answers: [noRelation], answeredBy: "stub" },
    ])
  })

  it("runs a variant without the stub without the server, whatever the case answers for it", () => {
    const mcpStubRules: McpCaseRules[] = [{ server: "pgsql", rules: [{ tool: "get_object_details", answers: [ordersDetails] }] }]

    expect(stubsFor({ mcpStubs: [] }, { mcpStubRules })).toEqual([])
  })
})
