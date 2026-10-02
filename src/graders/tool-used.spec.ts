import { describe, expect, it } from "vitest"
import { toolUsed } from "./tool-used.ts"
import { criteriaOf } from "#test/graders.ts"

describe("toolUsed", () => {
  const toolCalls = [
    { name: "Read", input: { file_path: "/w/.claude/rules/cqrs.md" } },
    { name: "Read", input: { file_path: "/w/src/a.cs" } },
    { name: "Bash", input: { command: "dotnet test" } },
  ]

  it("counts the matching tool calls against the expected range", async () => {
    expect(await criteriaOf(toolUsed("reads-rules", { tool: "Read", input: /rules/ }), { toolCalls })).toEqual([
      ["reads-rules", true, "1 Read /rules/ call(s), expected at least 1"],
    ])
    expect(await criteriaOf(toolUsed("no-web", { tool: /^Web/ }, { min: 0, max: 0 }), { toolCalls })).toEqual([
      ["no-web", true, "0 /^Web/ call(s), expected exactly 0"],
    ])
    expect(await criteriaOf(toolUsed("reads", { tool: "Read" }, { max: 1 }), { toolCalls })).toEqual([
      ["reads", false, "2 Read call(s), expected exactly 1"],
    ])
    expect(() => toolUsed("bad", { tool: "Read" }, { min: 2, max: 1 })).toThrow("expected 0 <= min <= max")
  })
})
