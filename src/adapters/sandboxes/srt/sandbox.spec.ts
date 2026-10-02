import { existsSync, realpathSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { NO_ACCESS } from "../../../ports/sandbox.ts"
import type { SrtSettings } from "./config.ts"
import { SrtSandbox } from "./sandbox.ts"
import { exists, sandboxSpec as spec } from "#test/adapters.ts"
import { tempDir } from "#test/helpers.ts"

/** A PATH entry holding an `rg`, so the srt preflight passes without ripgrep installed. */
async function fakeRgDir() {
  const dir = await tempDir()
  await writeFile(join(dir, "rg"), "")
  return dir
}

describe("srt sandbox", () => {
  it("hides the directory holding the trial roots, and the host temp and volume dirs that exist", async () => {
    const tmpRoot = await tempDir()
    const sandbox = new SrtSandbox({
      env: { PATH: await fakeRgDir() },
      hostHome: "/Users/me",
      tmpRoot,
      platform: "darwin",
      cli: "/srt/cli.js",
    })
    const ws = await sandbox.create(spec)

    const { denyRead } = (JSON.parse(await readFile(join(ws.cwd, "..", "srt-settings.json"), "utf8")) as SrtSettings).filesystem
    expect(denyRead).toEqual(expect.arrayContaining(["/Users/me", tmpRoot, realpathSync(tmpRoot), "/tmp"]))
    expect(denyRead.every((path: string) => existsSync(path) || path === "/Users/me")).toBe(true)
    await sandbox.destroy(ws)
  })

  it("writes its settings next to the workspace and wraps commands with the srt CLI", async () => {
    const sandbox = new SrtSandbox({
      env: { PATH: await fakeRgDir() },
      hostHome: "/Users/me",
      tmpRoot: await tempDir(),
      platform: "darwin",
      cli: "/srt/cli.js",
    })
    const ws = await sandbox.create(spec)

    const settings = join(ws.cwd, "..", "srt-settings.json")
    expect((JSON.parse(await readFile(settings, "utf8")) as SrtSettings).network.allowedDomains).toEqual(["api.anthropic.com"])
    expect(ws.wrap?.({ file: "claude", args: ["-p", "hi"] })).toEqual({
      file: process.execPath,
      args: ["/srt/cli.js", "--settings", settings, "--", "claude", "-p", "hi"],
    })
    expect(sandbox.isolation).toBe("full")
    expect(ws.env.CLAUDE_CODE_TMPDIR).toBe(ws.env.TMPDIR)
    await sandbox.destroy(ws)
    expect(await exists(settings)).toBe(false)
  })

  it("says what to install, or to fall back to local-temp, when srt cannot run", async () => {
    const tmpRoot = await tempDir()
    const noRg = new SrtSandbox({ env: { PATH: "/nowhere" }, tmpRoot, platform: "darwin" })
    const windows = new SrtSandbox({ env: { PATH: "/nowhere" }, tmpRoot, platform: "win32" })

    await expect(noRg.create({ ...spec, access: NO_ACCESS })).rejects.toThrow(
      "srt needs rg on PATH (outside your home directory): install rg, or pass --sandbox local-temp (isolation degraded).",
    )
    await expect(windows.create(spec)).rejects.toThrow("srt does not support win32: pass --sandbox local-temp")
  })
})
