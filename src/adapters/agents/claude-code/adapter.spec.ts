import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AgentRunError } from "../../../ports/agent.ts"
import { REDACTED } from "../../redact.ts"
import { ClaudeCodeAdapter, findExecutable } from "./adapter.ts"
import { fakeClaude, fakeWorkspace, input, oauth, stream } from "#test/adapters.ts"
import { fixturePath } from "#test/helpers.ts"

const fixtures = fixturePath()

const recorded = async (ws: { record: string }, kind: "args" | "env" | "stdin") =>
  (await readFile(`${ws.record}.${kind}`, "utf8")).split("\n")

describe("ClaudeCodeAdapter", () => {
  const adapter = (options: { transcriptsDir?: string } = {}) => new ClaudeCodeAdapter({ credential: oauth, bin: fakeClaude, ...options })

  it("reports its version, auth profile and what the sandbox must let through", async () => {
    const agent = adapter()

    expect(await agent.version()).toBe("9.9.9")
    expect(agent.details).toEqual({ auth: "oauth", credential: "CLAUDE_CODE_OAUTH_TOKEN" })
    expect(agent.sandboxAccess).toEqual({
      allowedDomains: ["api.anthropic.com", "claude.ai", "platform.claude.com"],
      readablePaths: [join(fixtures.replace(/\/$/, ""))],
    })
  })

  it("runs in the workspace with a sandbox config dir and only its credential, and keeps the transcript", async () => {
    const ws = await fakeWorkspace("tool-calls")
    const transcriptsDir = join(ws.record, "..", "transcripts")

    const result = await adapter({ transcriptsDir }).run(input(), ws)

    expect(result).toMatchObject({ finalText: "done", model: "claude-sonnet-5", turns: 3 })
    expect(await readFile(result.transcriptPath ?? "", "utf8")).toBe(await readFile(stream("tool-calls"), "utf8"))
    const env = await recorded(ws, "env")
    expect(env).toEqual(
      expect.arrayContaining([
        `HOME=${ws.home}`,
        `CLAUDE_CONFIG_DIR=${join(ws.home, ".claude")}`,
        "CLAUDE_CODE_OAUTH_TOKEN=fake-oauth-token",
        "ENABLE_CLAUDEAI_MCP_SERVERS=false",
      ]),
    )
    expect(env.some((line) => line.startsWith("ANTHROPIC_API_KEY="))).toBe(false)
    expect(await recorded(ws, "args")).toContain("--strict-mcp-config")
  })

  it("sends the prompt on stdin, whatever its size", async () => {
    const ws = await fakeWorkspace("say-ok")
    const prompt = `/sdlc:review eval-pr\n${"é".repeat(200_000)}`

    await adapter().run(input({ prompt }), ws)

    expect(await readFile(`${ws.record}.stdin`, "utf8")).toBe(prompt)
    expect((await recorded(ws, "args")).join(" ")).not.toContain("/sdlc:review")
  })

  it("launches through the sandbox wrapper when the workspace has one", async () => {
    const ws = await fakeWorkspace("say-ok")
    const wrapped: string[][] = []

    await adapter().run(input(), { ...ws, wrap: (c) => (wrapped.push([c.file, ...c.args]), c) })

    expect(wrapped[0]?.[0]).toBe(fakeClaude)
  })

  it("copies directory plugins into the sandbox home, installs marketplace ones, and fingerprints them", async () => {
    const ws = await fakeWorkspace("declared-plugins")
    const plugin = join(ws.record, "..", "sdlc")
    await mkdir(join(plugin, "skills"), { recursive: true })
    await writeFile(join(plugin, "skills", "SKILL.md"), "# review")
    const agent = adapter()
    const plugins = [plugin, "caveman@JuliusBrussee/caveman"]

    await agent.prepare({ ...input({ plugins }) }, ws)
    const result = await agent.run(input({ plugins }), ws)

    const copy = join(ws.home, ".proctor", "plugins", "0-sdlc")
    expect(await readFile(join(copy, "skills", "SKILL.md"), "utf8")).toBe("# review")
    const args = await recorded(ws, "args")
    expect(args.join(" ")).toContain("plugin marketplace add JuliusBrussee/caveman --scope user")
    expect(args.join(" ")).toContain("plugin install caveman@fake-market --scope user -y")
    expect(args[args.indexOf("--plugin-dir") + 1]).toBe(copy)
    expect(result.pluginSha).toMatch(/^[0-9a-f]{64}$/)
  })

  it("loads a bare plugin name from its plugin roots", async () => {
    const ws = await fakeWorkspace("declared-plugins")
    const root = join(ws.record, "..", "plugins")
    await mkdir(join(root, "sdlc"), { recursive: true })
    await writeFile(join(root, "sdlc", "plugin.md"), "sdlc")
    const agent = new ClaudeCodeAdapter({ credential: oauth, bin: fakeClaude, pluginRoots: [root] })

    await agent.prepare(input({ plugins: ["sdlc"] }), ws)

    expect(await readFile(join(ws.home, ".proctor", "plugins", "0-sdlc", "plugin.md"), "utf8")).toBe("sdlc")
  })

  it("says which credential was refused and how to get a new one, not the CLI's /login advice", async () => {
    const ws = await fakeWorkspace("not-logged-in", { FAKE_CLAUDE_EXIT: "1" })

    await expect(adapter().run(input(), ws)).rejects.toThrow(
      "claude refused the credential CLAUDE_CODE_OAUTH_TOKEN (profile oauth): Not logged in · Please run /login. " +
        "Fix: run `claude setup-token` and export the token as CLAUDE_CODE_OAUTH_TOKEN",
    )
  })

  it("keeps the transcript of a failed run, so the trial report can point at it", async () => {
    const ws = await fakeWorkspace("undeclared-mcp")
    const transcriptsDir = join(ws.record, "..", "transcripts")

    const error: unknown = await adapter({ transcriptsDir })
      .run(input(), ws)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AgentRunError)
    expect((error as AgentRunError).message).toContain("isolation probe")
    expect(await readFile((error as AgentRunError).transcriptPath, "utf8")).toContain('"subtype":"init"')
  })

  it("masks the credential in the transcript, tool outputs and final text", async () => {
    const ws = await fakeWorkspace("leaks-token")
    const transcriptsDir = join(ws.record, "..", "transcripts")

    const result = await adapter({ transcriptsDir }).run(input(), ws)

    const transcript = await readFile(result.transcriptPath ?? "", "utf8")
    expect(transcript).not.toContain("fake-oauth-token")
    expect(transcript).toContain(`TOKEN=${REDACTED}`)
    expect(result.toolCalls[0]?.output).toBe(`TOKEN=${REDACTED}`)
    expect(result.finalText).toBe(`done ${REDACTED}`)
  })

  it("installs marketplace plugins with the sandbox HOME and config dir, never with the credential", async () => {
    const ws = await fakeWorkspace("declared-plugins")

    await adapter().prepare({ ...input({ plugins: ["caveman@JuliusBrussee/caveman"] }) }, ws)

    const env = (await readFile(`${ws.record}.plugin-env`, "utf8")).split("\n")
    expect(env).toEqual(
      expect.arrayContaining([`HOME=${ws.home}`, `CLAUDE_CONFIG_DIR=${join(ws.home, ".claude")}`, "GIT_TERMINAL_PROMPT=0"]),
    )
    expect(env.some((line) => line.startsWith("CLAUDE_CODE_OAUTH_TOKEN="))).toBe(false)
  })

  it("says how to fix a missing binary", () => {
    expect(() => findExecutable("claude", "/nowhere")).toThrow('"claude" not found on PATH: install Claude Code')
  })
})
