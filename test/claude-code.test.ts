import { describe, expect, it } from "vitest"
import { runSuite, suite, regex } from "@fluce/proctor"
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
})
