import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

const root = new URL("..", import.meta.url).pathname
const eslint = new ESLint({ cwd: root })

async function boundaryErrors(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) })
  return (result?.messages ?? []).filter((m) => m.ruleId === "local/import-boundaries").map((m) => m.message)
}

describe("import boundaries (lint)", () => {
  it.each([
    ["src/core/orchestrator.ts", 'import { x } from "../adapters/agents/claude-code/adapter.ts"'],
    ["src/ports/agent.ts", 'export * from "../adapters/sandboxes/srt/sandbox.ts"'],
    ["src/core/lifecycle.ts", 'const m = await import("../reporters/ctrf.ts")'],
    ["src/ports/reporter.ts", 'import type { SuiteDefinition } from "../core/model.ts"'],
  ])("blocks %s from importing an outer layer", async (file, code) => {
    expect(await boundaryErrors(file, code)).toEqual([expect.stringMatching(/must not import src\/(adapters|reporters|core)\//)])
  })

  it.each([
    ["src/core/lifecycle.ts", 'import { FakeSandbox } from "@fluce/proctor/testing"', "src/testing/"],
    ["src/ports/agent.ts", 'import type { SuiteBuilder } from "@fluce/proctor"', "src/index.ts"],
  ])("blocks %s from importing an outer layer by package name", async (file, code, target) => {
    expect(await boundaryErrors(file, code)).toEqual([expect.stringContaining(`must not import ${target}`)])
  })

  it("finds no boundary violation in the real tree, whatever eslint-disable comments say", async () => {
    // Inline config off: an `eslint-disable local/import-boundaries` comment cannot hide a violation from this test.
    const strict = new ESLint({ cwd: root, allowInlineConfig: false })
    const results = await strict.lintFiles(["src", "test", "examples", "scripts"])
    const violations = results.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === "local/import-boundaries").map((m) => `${r.filePath}: ${m.message}`),
    )
    expect(violations).toEqual([])
  })

  it("closes core/ and ports/ by default: a directory added later is refused until the config allows it", async () => {
    expect(await boundaryErrors("src/core/lifecycle.ts", 'import { x } from "../plugins/registry.ts"')).toEqual([
      expect.stringContaining("src/core/ must not import src/plugins/"),
    ])
    expect(await boundaryErrors("src/core/lifecycle.ts", 'import { clip } from "../shared/text.ts"')).toEqual([])
    expect(await boundaryErrors("src/shared/text.ts", 'import type { Grader } from "../ports/grader.ts"')).toEqual([
      expect.stringContaining("src/shared/ must not import src/ports/"),
    ])
  })

  it("refuses an import() of a computed path, which no static check can follow, outside the eval-ts loader", async () => {
    const code = "export const load = (path: string): Promise<unknown> => import(path)"
    expect(await boundaryErrors("src/core/lifecycle.ts", code)).toEqual([expect.stringContaining("computed path")])
    expect(await boundaryErrors("src/loaders/eval-ts.ts", code)).toEqual([])
  })

  it("blocks imports from outside the package", async () => {
    const errors = await boundaryErrors("src/cli/run.ts", 'import "../../../runner/run.sh"')
    expect(errors).toEqual([expect.stringMatching(/outside the proctor package/)])
  })

  it("lets the CLI wire concrete modules", async () => {
    expect(await boundaryErrors("src/cli/registry.ts", 'import { FakeSandbox } from "../testing/fake-sandbox.ts"')).toEqual([])
  })

  it("keeps behavior tests on what a user drives, and lets the shared support reach internals", async () => {
    expect(await boundaryErrors("test/lifecycle.test.ts", 'import { runTrial } from "../src/core/lifecycle.ts"')).toEqual([
      expect.stringContaining("test/ must not import src/core/: a behavior test drives the package as a user does"),
    ])
    expect(await boundaryErrors("test/cli.test.ts", 'import { main } from "../src/cli/main.ts"')).toEqual([])
    expect(
      await boundaryErrors("test/srt.integration.test.ts", 'import { SrtSandbox } from "../src/adapters/sandboxes/srt/sandbox.ts"'),
    ).toEqual([])
    expect(await boundaryErrors("test/support/helpers.ts", 'import { asError } from "../../src/core/errors.ts"')).toEqual([])
  })
})

describe("code conventions (lint)", () => {
  async function messages(file: string, code: string, rule: string) {
    const [result] = await eslint.lintText(code, { filePath: join(root, file) })
    return (result?.messages ?? []).filter((m) => m.ruleId === rule).map((m) => m.message)
  }

  it.each([
    ["eslint/StreamParser.js", ["File name 'StreamParser.js' is not kebab-case: rename it, e.g. 'stream-parser.ts'."]],
    ["eslint/stream_parser.js", ["File name 'stream_parser.js' is not kebab-case: rename it, e.g. 'stream-parser.ts'."]],
    ["eslint/srt.integration.test.js", []],
  ])("requires kebab-case file names: %s", async (file, expected) => {
    expect(await messages(file, "", "local/filename-case")).toEqual(expected)
  })

  it.each([
    ['import { readFile } from "fs/promises"', "node: prefix"],
    ["class A {\n  private x = 1\n}", "#private"],
    ["export default 1", "named export"],
  ])("refuses %j in src/", async (code, says) => {
    expect(await messages("src/core/duration.ts", code, "no-restricted-syntax")).toEqual([expect.stringContaining(says)])
  })

  it("lets an eval file keep its default export", async () => {
    expect(await messages("examples/hello.eval.ts", "export default 1", "no-restricted-syntax")).toEqual([])
  })

  it("refuses nested ternaries", async () => {
    const code = "export const f = (a: number): string => (a > 0 ? 'p' : a < 0 ? 'n' : 'z')"
    expect(await messages("src/core/duration.ts", code, "no-nested-ternary")).toHaveLength(1)
  })
})

describe("agnosticism", () => {
  it.each(["src/core", "src/ports"])("%s never mentions a concrete agent, sub-directories included", async (dir) => {
    const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true })
    const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(await readFile(file, "utf8"), file).not.toMatch(/claude/i)
    }
  })
})
