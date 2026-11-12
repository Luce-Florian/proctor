import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { materializeStubs } from "./materialize.ts"
import { tempWorkspace } from "#test/helpers.ts"
import { stub, stubTool } from "#test/mcp-stubs.ts"

const pgsql = stub("pgsql", stubTool("list_instances"))

/** Where a trial's stub files sit. */
const stubDir = (home: string) => join(home, ".proctor", "mcp")

describe("materializeStubs", () => {
  it("runs each stub with the harness's own node, from the copy of the stub program in the trial home", async () => {
    const workspace = await tempWorkspace()
    const dir = stubDir(workspace.home)

    const entries = await materializeStubs([pgsql], workspace)

    expect(entries).toEqual([
      {
        name: "pgsql",
        command: process.execPath,
        args: [join(dir, "adapters/mcp-stub/stub-server.mjs"), join(dir, "pgsql.json"), join(dir, "pgsql.jsonl")],
        tools: ["list_instances"],
      },
    ])
  })

  it.each([
    ["the stub program", "adapters/mcp-stub/stub-server.mjs"],
    ["the rules module it imports", "ports/mcp-stub-rules.mjs"],
  ])("copies %s at its path under src/, so that the program's relative import resolves", async (_, file) => {
    const workspace = await tempWorkspace()

    await materializeStubs([pgsql], workspace)

    expect(await readFile(join(stubDir(workspace.home), file), "utf8")).toBe(
      await readFile(new URL(`../../${file}`, import.meta.url), "utf8"),
    )
  })

  it("writes nothing when the trial has no stub", async () => {
    const workspace = await tempWorkspace()

    await materializeStubs([], workspace)

    expect(existsSync(join(workspace.home, ".proctor"))).toBe(false)
  })
})
