import { execFileSync } from "node:child_process"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readWorkspaceFile } from "./fs.ts"
import { tempDir } from "#test/helpers.ts"

/** A workspace root holding `out/report.json`, and a host secret next to it. */
async function workspaceWithSecret() {
  const host = await tempDir()
  const root = join(host, "work")
  await mkdir(join(root, "out"), { recursive: true })
  await writeFile(join(root, "out", "report.json"), '{"ok":true}')
  const secret = join(host, "secret.txt")
  await writeFile(secret, "token")
  return { root, secret }
}

describe("readWorkspaceFile", () => {
  it("reads a regular file of the workspace", async () => {
    const { root } = await workspaceWithSecret()

    expect(await readWorkspaceFile(root, "out/report.json")).toBe('{"ok":true}')
  })

  it("refuses a path that leaves the workspace", async () => {
    const { root } = await workspaceWithSecret()

    await expect(readWorkspaceFile(root, "../secret.txt")).rejects.toThrow('"../secret.txt" is outside the workspace')
  })

  it("refuses a symbolic link to a host file", async () => {
    const { root, secret } = await workspaceWithSecret()
    await symlink(secret, join(root, "out", "leak.txt"))

    await expect(readWorkspaceFile(root, "out/leak.txt")).rejects.toThrow('"out/leak.txt" is not a regular file')
  })

  it("reads a file under a directory linked inside the workspace", async () => {
    const { root } = await workspaceWithSecret()
    await symlink(join(root, "out"), join(root, "results"))

    expect(await readWorkspaceFile(root, "results/report.json")).toBe('{"ok":true}')
  })

  it("says the agent left no file when there is none", async () => {
    const { root } = await workspaceWithSecret()

    await expect(readWorkspaceFile(root, "out/missing.json")).rejects.toThrow('the agent left no file "out/missing.json" in the workspace')
  })

  it("refuses a file under a directory linked to the host", async () => {
    const { root, secret } = await workspaceWithSecret()
    await symlink(join(secret, ".."), join(root, "host"))

    await expect(readWorkspaceFile(root, "host/secret.txt")).rejects.toThrow('"host/secret.txt" resolves outside the workspace')
  })

  it.skipIf(process.platform === "win32")("refuses a FIFO without waiting for a writer", async () => {
    const { root } = await workspaceWithSecret()
    execFileSync("mkfifo", [join(root, "out", "pipe")])

    await expect(readWorkspaceFile(root, "out/pipe")).rejects.toThrow('"out/pipe" is not a regular file')
  })

  it("refuses a file over the size it may hold, before reading it", async () => {
    const { root } = await workspaceWithSecret()
    await truncate(join(root, "out", "report.json"), 2048)

    await expect(readWorkspaceFile(root, "out/report.json", { maxBytes: 1024 })).rejects.toThrow(
      '"out/report.json" holds 2048 bytes, over the 1024 bytes it may hold',
    )
  })
})
