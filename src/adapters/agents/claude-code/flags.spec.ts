import { describe, expect, it } from "vitest"
import { claudeArgs } from "./flags.ts"
import { input } from "#test/adapters.ts"

describe("claude flags", () => {
  it("isolates the config and maps the neutral input", () => {
    const args = claudeArgs(
      input({
        prompt: "/sdlc:review eval-pr",
        model: "claude-sonnet-5",
        permissions: "full",
        settings: { hooks: {} },
        mcpServers: { docs: { command: "d" } },
      }),
      { pluginDirs: ["/ws/home/.proctor/plugins/0-sdlc"] },
    )

    expect(args[0]).toBe("-p")
    // The prompt goes on stdin: no argument size limit, and nothing for srt to re-quote.
    expect(args).not.toContain("/sdlc:review eval-pr")
    expect(args.join(" ")).toContain("--output-format stream-json --verbose --no-session-persistence --setting-sources user")
    expect(args).toEqual(
      expect.arrayContaining(["--strict-mcp-config", "--model", "claude-sonnet-5", "--plugin-dir", "/ws/home/.proctor/plugins/0-sdlc"]),
    )
    expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{"docs":{"command":"d"}}}')
    expect(args[args.indexOf("--settings") + 1]).toBe('{"hooks":{}}')
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions")
    expect(args).not.toContain("--bare")
    expect(args).not.toContain("--safe-mode")
  })

  it.each([
    ["readonly", ["--permission-mode", "dontAsk", "--tools", "Read"]],
    ["workspace-write", ["--permission-mode", "acceptEdits", "--permission-prompts", "none"]],
  ] as const)("maps %s permissions", (permissions, flags) => {
    const args = claudeArgs(input({ permissions }), { pluginDirs: [] })
    expect(args.join(" ")).toContain(flags.join(" "))
    expect(args).not.toContain("--settings")
  })
})
