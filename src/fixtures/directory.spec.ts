import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Workspace } from "../ports/workspace.ts"
import { directory } from "./directory.ts"
import { tempDir } from "#test/helpers.ts"

const source = new URL("../../examples/hello", import.meta.url)

async function workspace(): Promise<Workspace> {
  const cwd = await tempDir()
  return { cwd, home: cwd, env: {} }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe("directory fixture", () => {
  it("copies the directory content into the workspace and removes it on teardown", async () => {
    const ws = await workspace()
    const teardown = await directory(source).setup(ws)

    expect(await readFile(join(ws.cwd, "greeting.txt"), "utf8")).toContain("directory() fixture")
    await teardown?.()
    expect(await exists(join(ws.cwd, "greeting.txt"))).toBe(false)
  })

  it("copies into a sub-directory with `into`", async () => {
    const ws = await workspace()
    const teardown = await directory(source, { into: "repo" }).setup(ws)

    expect(await exists(join(ws.cwd, "repo", "greeting.txt"))).toBe(true)
    await teardown?.()
    expect(await exists(join(ws.cwd, "repo"))).toBe(false)
  })

  it("tears down only what it created, keeping what the workspace already had", async () => {
    const overlay = await tempDir()
    await mkdir(join(overlay, "src"))
    await writeFile(join(overlay, "src", "added.ts"), "added")
    await writeFile(join(overlay, "top.txt"), "top")
    const ws = await workspace()
    await mkdir(join(ws.cwd, "src"))
    await writeFile(join(ws.cwd, "src", "existing.ts"), "existing")

    const teardown = await directory(overlay).setup(ws)
    expect(await exists(join(ws.cwd, "src", "added.ts"))).toBe(true)
    await teardown?.()

    expect(await readFile(join(ws.cwd, "src", "existing.ts"), "utf8")).toBe("existing")
    expect(await exists(join(ws.cwd, "src", "added.ts"))).toBe(false)
    expect(await exists(join(ws.cwd, "top.txt"))).toBe(false)
  })

  it("explains how to fix a missing directory", async () => {
    const setup = directory("does-not-exist").setup(await workspace())

    await expect(setup).rejects.toThrow(/is not a directory\. Pass new URL\("\.\/dir", import\.meta\.url\)/)
  })
})
