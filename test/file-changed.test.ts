import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { directory, fileChanged, fileUnchanged, runSuite, suite } from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { tempDir } from "#test/helpers.ts"

describe("fileChanged / fileUnchanged", () => {
  it("compares the workspace right before and after the run, without running git", async () => {
    const source = await tempDir()
    await mkdir(join(source, "src"))
    await writeFile(join(source, "src", "a.ts"), "a")
    await writeFile(join(source, "README.md"), "r")
    const agent = new FakeAgentAdapter({
      reply: async (_input, workspace) => {
        await writeFile(join(workspace.cwd, "src", "a.ts"), "changed")
        await rm(join(workspace.cwd, "README.md"))
        return "done"
      },
    })
    const definition = suite("files")
      .variant("v", (v) =>
        v.prompt("edit").beforeEach(async ({ workspace }) => writeFile(join(workspace.cwd, "setup.txt"), "before the run")),
      )
      .case("c", (c) =>
        c
          .fixture(directory(source))
          .expect(fileChanged("edits-a", "src/a.ts"))
          .expect(fileChanged("deletes-readme", /^README/))
          .expect(fileUnchanged("keeps-setup", "setup.txt"))
          .expect(fileChanged("creates-new", /new/)),
      )
      .toDefinition()

    const run = await runSuite(definition, { agent, sandbox: new FakeSandbox() })

    expect(run.trials[0]?.grades.map((g) => [g.graderId, g.passed, g.criteria[0]?.why])).toEqual([
      ["edits-a", true, "1 file(s) matching src/a.ts changed: src/a.ts"],
      ["deletes-readme", true, "1 file(s) matching /^README/ changed: README.md"],
      ["keeps-setup", true, "no file matching setup.txt changed"],
      ["creates-new", false, "no file matching /new/ changed"],
    ])
  })
})
