import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { changedPaths, fingerprint } from "./fingerprint-claude-home.ts"
import { tempDir } from "#test/helpers.ts"

async function claudeHome() {
  const home = await tempDir()
  await mkdir(join(home, "plugins", "cache"), { recursive: true })
  await writeFile(join(home, "settings.json"), "{}")
  await writeFile(join(home, "plugins", "known_marketplaces.json"), "{}")
  await writeFile(join(home, "plugins", "cache", "plugin.json"), "{}")
  return home
}

describe("fingerprint of ~/.claude", () => {
  it("hashes the watched paths and is stable", async () => {
    const home = await claudeHome()
    const before = await fingerprint(home)

    expect(Object.keys(before)).toEqual(["settings.json", "plugins", "plugins/known_marketplaces.json"])
    expect(Object.values(before).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true)
    expect(changedPaths(before, await fingerprint(home))).toEqual([])
  })

  it("reports what changed, including a file deep in plugins/", async () => {
    const home = await claudeHome()
    const before = await fingerprint(home)
    await writeFile(join(home, "plugins", "cache", "plugin.json"), '{"changed":true}')

    expect(changedPaths(before, await fingerprint(home))).toEqual(["plugins"])
  })

  it("marks a missing path as absent", async () => {
    const home = await tempDir()

    expect(await fingerprint(home)).toEqual({
      "settings.json": "absent",
      plugins: "absent",
      "plugins/known_marketplaces.json": "absent",
    })
  })
})
