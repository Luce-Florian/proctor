import { describe, expect, it } from "vitest"
import { mcpStub, runSuite, suite, regex } from "@fluce/proctor"
import { ClaudeCodeAdapter } from "../src/adapters/agents/claude-code/adapter.ts"
import { fakeClaude, fakeWorkspace, oauth } from "#test/adapters.ts"

describe("ClaudeCodeAdapter", () => {
  const adapter = (options: { transcriptsDir?: string } = {}) => new ClaudeCodeAdapter({ credential: oauth, bin: fakeClaude, ...options })

  it("stops a session that loaded an undeclared MCP server: the trial is other", async () => {
    const ws = await fakeWorkspace("undeclared-mcp")
    const definition = suite("probe")
      .variant("v", (v) => v.prompt("hi"))
      .case("c", (c) => c.expect(regex("any", /./)))
      .toDefinition()
    const sandbox = { id: "given", isolation: "full" as const, create: async () => ws, destroy: async () => undefined }

    const run = await runSuite(definition, { agent: adapter(), sandbox })

    expect(run.trials[0]).toMatchObject({ status: "other" })
    expect(run.trials[0]?.message).toContain("isolation probe: the session loaded what the variant did not declare")
    expect(run.trials[0]?.message).toContain("mcp__claude_ai_Gmail__send_message")
  })

  /**
   * test/fixtures/stream-json/mcp-stub.jsonl is built by hand, not recorded: tool-calls.jsonl (recorded with Claude Code
   * 2.1.280) with its init listing the stub as the design spike observed it on 2.1.286
   * (`{"name":"pgsql","status":"connected","source":"dynamic"}`, tool `mcp__pgsql__get_object_details`), and one
   * tool_use / tool_result pair of that tool. To record it for real, run a variant with this stub under
   * `claude -p --output-format stream-json --verbose --strict-mcp-config --mcp-config <the stub entry> --allowedTools mcp__pgsql`,
   * then anonymize ids, paths and timestamps as the other fixtures are.
   */
  it("runs an MCP stub the session calls, and marks the calls it answered", async () => {
    const ws = await fakeWorkspace("mcp-stub", { FAKE_CLAUDE_NODE: process.execPath })
    const pgsql = mcpStub("pgsql").tool("get_object_details", (t) => t.description("Columns and indexes of a table."))
    const definition = suite("sql-review")
      .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt("Review change.diff"))
      .case("index-exists", (c) =>
        c
          .mcpStub(pgsql, (s) => s.on("get_object_details", { object_name: "orders" }).returns({ table: "public.orders" }))
          .expect(regex("answers", /no blocker/)),
      )
      .toDefinition()
    const sandbox = { id: "given", isolation: "full" as const, create: async () => ws, destroy: async () => undefined }

    const run = await runSuite(definition, { agent: adapter(), sandbox })

    expect(run.trials[0]?.agentResult?.toolCalls[0]?.mcp).toEqual({ server: "pgsql", tool: "get_object_details", answeredBy: "case" })
  })
})
