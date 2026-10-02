import { symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { jsonPath, parseJsonPath } from "./json-path.ts"
import { criteriaOf } from "#test/graders.ts"
import { tempDir } from "#test/helpers.ts"

describe("jsonPath", () => {
  it("reads the value at the path of the JSON answer, fences tolerated", async () => {
    const finalText = '```json\n{"verdict": "oui", "findings": [{"file": "a.cs"}, {"file": "b.cs"}]}\n```'

    expect(await criteriaOf(jsonPath("v", "$.verdict", "oui"), { finalText })).toEqual([["v", true, '$.verdict is "oui"']])
    expect(
      await criteriaOf(
        jsonPath("n", "$.findings.length", (n) => n === 3),
        { finalText },
      ),
    ).toEqual([["n", false, "$.findings.length is 2, expected satisfying the predicate"]])
    expect(await criteriaOf(jsonPath("f", "$.findings[1].file", /\.cs$/), { finalText })).toEqual([
      ["f", true, '$.findings[1].file is "b.cs"'],
    ])
    expect(await criteriaOf(jsonPath("x", "$.missing", 1), { finalText })).toEqual([["x", false, "the final text has no $.missing"]])
  })

  it("fails the criterion, not the trial, on an answer that is not JSON", async () => {
    const [[, met, why]] = (await criteriaOf(jsonPath("v", "$.verdict", "oui"), { finalText: "oui" })) as [[string, boolean, string]]
    expect([met, why]).toEqual([false, expect.stringContaining("the final text is not JSON")])
  })

  it("reads a workspace file, never through a symbolic link", async () => {
    const cwd = await tempDir()
    await writeFile(join(cwd, "out.json"), '{"ok": true}')
    await symlink(join(cwd, "out.json"), join(cwd, "link.json"))

    expect(await criteriaOf(jsonPath("f", "$.ok", true, { file: "out.json" }), {}, cwd)).toEqual([["f", true, "$.ok is true"]])
    expect((await criteriaOf(jsonPath("l", "$.ok", true, { file: "link.json" }), {}, cwd))[0]?.[2]).toContain(
      "a symbolic link is never followed",
    )
  })

  it("never reads through a symbolic link to a directory outside the workspace", async () => {
    const cwd = await tempDir()
    const host = await tempDir()
    await writeFile(join(host, "credentials.json"), '{"ok": true, "secret": "HOST-SECRET"}')
    await symlink(host, join(cwd, "out"))

    const [[, met, why]] = (await criteriaOf(jsonPath("s", "$.secret", "x", { file: "out/credentials.json" }), {}, cwd)) as [
      [string, boolean, string],
    ]

    expect(met).toBe(false)
    expect(why).toContain('"out/credentials.json" resolves outside the workspace')
    expect(why).not.toContain("HOST-SECRET")
  })

  it("says why a file could not be read, apart from a file that is not JSON", async () => {
    const cwd = await tempDir()
    await writeFile(join(cwd, "bad.json"), "not json")

    expect((await criteriaOf(jsonPath("m", "$.ok", true, { file: "missing.json" }), {}, cwd))[0]?.[2]).toBe(
      'cannot read "missing.json": the agent left no file "missing.json" in the workspace',
    )
    expect((await criteriaOf(jsonPath("b", "$.ok", true, { file: "bad.json" }), {}, cwd))[0]?.[2]).toMatch(/^"bad\.json" is not JSON: /)
  })

  it("rejects a path it cannot read, saying the syntax, and a file outside the workspace when defined", () => {
    expect(parseJsonPath("$.a[0].b")).toEqual(["a", 0, "b"])
    expect(() => jsonPath("x", "a.b", 1)).toThrow('Invalid JSON path "a.b": use $.key.other[0]')
    expect(() => jsonPath("o", "$.ok", true, { file: "../secret.json" })).toThrow(
      'jsonPath "o": file "../secret.json" is outside the workspace',
    )
    expect(() => jsonPath("o", "$.ok", true, { file: "/etc/passwd" })).toThrow('jsonPath "o": file "/etc/passwd" is outside the workspace')
  })
})
