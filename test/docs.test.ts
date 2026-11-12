import { readdir, readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { typeErrors } from "#test/typecheck.ts"

const root = new URL("../", import.meta.url)
const read = (path: string) => readFile(new URL(path, root), "utf8")

/** Pages of one locale of the site, relative to its root: `docs/` for English, `docs/fr/` for French. */
async function pages(locale: "en" | "fr"): Promise<string[]> {
  const dir = locale === "en" ? "docs/" : "docs/fr/"
  const entries = await readdir(new URL(dir, root), { recursive: true })
  return entries
    .filter((path) => path.endsWith(".md"))
    .filter((path) => !/(^|\/)(node_modules|\.vitepress)\//.test(path))
    .filter((path) => locale === "fr" || !path.startsWith("fr/"))
    .sort()
}

/** Fenced code blocks of a page, with their language. */
const codeBlocks = (markdown: string) =>
  [...markdown.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)].map((m) => ({ lang: m[1] ?? "", code: m[2] ?? "" }))

/** Blocks a reader copies and runs: identical in every locale. Prose diagrams (mermaid, text) may be translated. */
const RUNNABLE = new Set(["ts", "sh", "console", "json"])

/** The `ts` block of a page that opens with `// <example path>`, without that line. */
function exampleBlock(markdown: string, example: string): string | undefined {
  const header = `// ${example}\n`
  return codeBlocks(markdown)
    .find((block) => block.lang === "ts" && block.code.startsWith(header))
    ?.code.slice(header.length)
}

describe("README", () => {
  it("opens with the exact content of examples/hello.eval.ts, which the CLI tests run", async () => {
    expect(exampleBlock(await read("README.md"), "examples/hello.eval.ts")).toBe(await read("examples/hello.eval.ts"))
  })
})

describe("MCP stubs page", () => {
  it("opens with the exact content of examples/mcp-stub.eval.ts, which the CLI tests run", async () => {
    const page = await read("docs/writing-evals/mcp-stubs.md")

    expect(exampleBlock(page, "examples/mcp-stub.eval.ts")).toBe(await read("examples/mcp-stub.eval.ts"))
  })
})

describe("docs", () => {
  it("only shows authoring examples that compile against the package", async () => {
    const files = ["README.md", ...(await pages("en")).map((page) => `docs/${page}`)]
    const blocks = (await Promise.all(files.map(async (file) => codeBlocks(await read(file)).map((b) => ({ file, ...b })))))
      .flat()
      .filter((b) => b.lang === "ts" && b.code.includes('from "@fluce/proctor"'))

    expect(blocks.length).toBeGreaterThanOrEqual(5)
    for (const block of blocks) expect(typeErrors(block.code), `${block.file}: ${block.code.split("\n")[0]}`).toEqual([])
  })

  it("has a French page for every English page, and no other", async () => {
    expect(await pages("fr")).toEqual(await pages("en"))
  })

  it("keeps the runnable code blocks of each French page identical to the English ones", async () => {
    for (const page of await pages("en")) {
      const runnable = async (file: string) => codeBlocks(await read(file)).filter((b) => RUNNABLE.has(b.lang))
      expect(await runnable(`docs/fr/${page}`), page).toEqual(await runnable(`docs/${page}`))
    }
  })
})
