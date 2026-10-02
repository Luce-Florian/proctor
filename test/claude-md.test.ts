import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { typeErrors } from "#test/typecheck.ts"

describe("CLAUDE.md", () => {
  it("shows an authoring example that compiles against the package", async () => {
    const guide = await readFile(new URL("../CLAUDE.md", import.meta.url), "utf8")
    const example = /## API developer experience[\s\S]*?```ts\n([\s\S]*?)```/.exec(guide)?.[1]

    expect(example).toContain('from "@fluce/proctor"')
    expect(typeErrors(example ?? "")).toEqual([])
  })

  it("would catch an example that does not compile", () => {
    expect(typeErrors('import { judge } from "@fluce/proctor"\nexport const j: number = judge()\n')).toHaveLength(1)
  })
})
