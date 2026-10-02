import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { typeErrors } from "#test/typecheck.ts"

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

describe("README", () => {
  it("opens with the exact content of examples/hello.eval.ts, which the CLI tests run", async () => {
    const readme = await read("README.md")
    const firstTsBlock = /```ts\n\/\/ examples\/hello\.eval\.ts\n([\s\S]*?)```/.exec(readme)?.[1]

    expect(firstTsBlock).toBe(await read("examples/hello.eval.ts"))
  })

  it("only shows authoring examples that compile against the package", async () => {
    const blocks = [...(await read("README.md")).matchAll(/```ts\n([\s\S]*?)```/g)]
      .map((m) => m[1] ?? "")
      .filter((b) => b.includes('from "@fluce/proctor"'))

    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const block of blocks) expect(typeErrors(block), block.split("\n")[0]).toEqual([])
  })
})
