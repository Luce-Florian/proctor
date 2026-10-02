import { describe, expect, it } from "vitest"
import { probeHooks, probeInit } from "./init-probe.ts"
import type { InitEvent } from "./stream-parser.ts"
import { collect } from "#test/adapters.ts"

describe("isolation probe (system/init)", () => {
  const none = { pluginDirs: [], pluginIds: [], mcpServers: [], hookEvents: [] }
  const init = async (name: string) => (await collect(name)).init as InitEvent

  it("accepts a session that loaded only built-in plugins", async () => {
    expect(probeInit(await init("say-ok"), none)).toEqual([])
  })

  it("flags an undeclared MCP server and its claude.ai tools", async () => {
    expect(probeInit(await init("undeclared-mcp"), none)).toEqual([
      'undeclared MCP server "claude.ai Gmail"',
      "undeclared MCP tool mcp__claude_ai_Gmail__send_message",
      "undeclared MCP tool mcp__claude_ai_Gmail__search_threads",
    ])
  })

  it("flags the host plugins that --safe-mode still lists on a real config", async () => {
    const problems = probeInit(await init("undeclared-plugins"), none)

    expect(problems).toHaveLength(6)
    expect(problems[0]).toMatch(/^undeclared plugin "shared-feedback-loop@shared-claude-marketplace-lib"/)
  })

  it("flags a declared plugin that did not load, e.g. unreadable under the sandbox", async () => {
    expect(probeInit(await init("say-ok"), { ...none, pluginDirs: ["/ws/home/.proctor/plugins/0-sdlc"] })).toEqual([
      "declared plugin /ws/home/.proctor/plugins/0-sdlc did not load: is it readable inside the sandbox?",
    ])
  })

  it("flags a SessionStart hook the variant did not declare, e.g. from the host managed settings", async () => {
    const hooks = (await collect("undeclared-hook")).hooks

    expect(probeHooks(hooks, { ...none, hookEvents: [] })).toEqual([
      'undeclared hook "SessionStart:startup": neither in the variant settings nor from a plugin (host managed settings?)',
    ])
    expect(probeHooks(hooks, { ...none, hookEvents: ["SessionStart"] })).toEqual([])
    expect(probeHooks(hooks, { ...none, pluginDirs: ["/p"], hookEvents: [] })).toEqual([])
  })

  it("accepts declared MCP servers and their tools", () => {
    const withDocs: InitEvent = { type: "system", subtype: "init", mcp_servers: [{ name: "docs" }], tools: ["Read", "mcp__docs__search"] }
    expect(probeInit(withDocs, { ...none, mcpServers: ["docs"] })).toEqual([])
  })
})
