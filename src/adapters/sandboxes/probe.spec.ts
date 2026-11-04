import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Command, Workspace } from "../../ports/workspace.ts"
import { probeSandbox } from "./probe.ts"
import { tempDir } from "#test/helpers.ts"

/** A workspace whose sandbox runs every command through `wrap`. */
async function workspaceWrappedBy(wrap?: (command: Command) => Command): Promise<Workspace> {
  const cwd = await tempDir()
  return { cwd, home: cwd, env: { PATH: process.env.PATH ?? "" }, ...(wrap && { wrap }) }
}

const signal = new AbortController().signal

describe("probeSandbox", () => {
  it("passes when the sandbox runs the command and the workspace is writable, and leaves the workspace as it was", async () => {
    const ws = await workspaceWrappedBy((command) => command)

    await probeSandbox(ws, signal)

    expect(await readdir(ws.cwd)).toEqual([])
  })

  it("fails with the sandbox's own stderr when it refuses to start", async () => {
    const refusing = (): Command => ({ file: "/bin/sh", args: ["-c", "echo 'bwrap: Read-only file system' >&2; exit 1"] })
    const ws = await workspaceWrappedBy(refusing)

    await expect(probeSandbox(ws, signal)).rejects.toThrow(
      "The sandbox did not run a command in the workspace (exit 1): bwrap: Read-only file system.",
    )
  })

  it("does nothing for a workspace without wrap", async () => {
    const ws = { cwd: join(await tempDir(), "missing"), home: "/nowhere", env: {} }

    await probeSandbox(ws, signal)

    expect(existsSync(ws.cwd)).toBe(false)
  })
})
