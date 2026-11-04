import { describe, expect, it } from "vitest"
import type { Command } from "../ports/workspace.ts"
import { agents, sandboxIdFor } from "./registry.ts"
import { input } from "#test/adapters.ts"
import { tempDir } from "#test/helpers.ts"

describe("sandbox selection", () => {
  it("defaults to srt for any real agent, and to the fake sandbox for the fake agent", () => {
    expect(sandboxIdFor("claude-code", undefined)).toBe("srt")
    expect(sandboxIdFor("fake", undefined)).toBe("fake")
    expect(sandboxIdFor("claude-code", "local-temp")).toBe("local-temp")
  })
})

describe("the fake agent of the CLI", () => {
  const fake = () => agents.fake?.({ outDir: "/unused", env: {} })

  it("answers once the sandbox ran a command in the workspace: a dry run checks the sandbox", async () => {
    const cwd = await tempDir()

    const result = await fake()?.run(input({ prompt: "hi" }), { cwd, home: cwd, env: { PATH: process.env.PATH ?? "" }, wrap: (c) => c })

    expect(result?.finalText).toBe("echo: hi")
  })

  it("fails the run when the sandbox refuses to start, as a real agent would", async () => {
    const cwd = await tempDir()
    const refusing = (): Command => ({ file: "/bin/sh", args: ["-c", "echo 'bwrap: denied' >&2; exit 1"] })

    const run = fake()?.run(input(), { cwd, home: cwd, env: { PATH: process.env.PATH ?? "" }, wrap: refusing })

    await expect(run).rejects.toThrow("The sandbox did not run a command in the workspace (exit 1): bwrap: denied.")
  })
})
