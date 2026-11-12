import { describe, expect, it } from "vitest"
import { answerStub } from "./answer-stub.ts"
import { stub, stubTool } from "#test/mcp-stubs.ts"

describe("answerStub", () => {
  it("says how to give the trial a stub it lacks", () => {
    const tickets = stub("tickets", stubTool("get_ticket"))

    expect(() => answerStub([tickets], "pgsql", "get_object_details", {})).toThrow(
      'answerStub: no MCP stub "pgsql" in this trial (declared: tickets); pass the mcpStub("pgsql") value to .mcpStub(...) on the variant',
    )
  })
})
