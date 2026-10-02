import { describe, expect, it } from "vitest"
import type { Grader } from "../ports/grader.ts"
import { readVerdict, verdictEquals, verdictIs } from "./verdict-equals.ts"
import { criteriaOf } from "#test/graders.ts"
import { gradeContext } from "#test/helpers.ts"

describe("verdictEquals", () => {
  const grade = (grader: Grader, finalText: string) => criteriaOf(grader, { finalText })

  it("reads the verdict on the first line only, exactly the word: no decoration, no later line, case included", async () => {
    expect(await grade(verdictEquals("v", "no"), "non")).toEqual([["v", true, 'verdict "non", expected "non"']])
    expect(await grade(verdictEquals("v", "no"), "\uFEFF  non \r\n")).toEqual([["v", true, 'verdict "non", expected "non"']])
    expect(await grade(verdictEquals("v", "yes"), "non")).toEqual([["v", false, 'verdict "non", expected "oui"']])
    expect(await grade(verdictEquals("v", "no"), "**Non.**")).toEqual([
      ["v", false, 'the first line "**Non.**" is no verdict, expected "non" alone'],
    ])
    expect(await grade(verdictEquals("v", "no"), "Le diff est du CSS.\n\nnon")).toEqual([
      ["v", false, 'the first line "Le diff est du CSS." is no verdict, expected "non" alone'],
    ])
    expect((await grade(verdictEquals("v", "no"), "NON"))[0]?.[1]).toBe(false)
    expect(await grade(verdictEquals("v", ["no", "yes"]), "I cannot tell")).toEqual([
      ["v", false, 'the first line "I cannot tell" is no verdict, expected "non" or "oui" alone'],
    ])
  })

  it("only grades the verdict: one principal criterion, whatever follows it", async () => {
    const result = await verdictEquals("v", "yes").grade(gradeContext({ finalText: "oui\n## Détails\n\nConfiance : haute" }))
    expect(result.criteria).toEqual([{ id: "v", met: true, why: 'verdict "oui", expected "oui"', principal: true }])
  })

  it("is the gate verdictIs reads, by the same strict rule: the gate and the verdict never disagree", async () => {
    const run = (finalText: string) => ({ finalText, durationMs: 0, turns: 1, toolCalls: [] })
    for (const text of ["oui\n- migration", "**Oui**\n- migration", "Oui", "Je pense.\noui", "non", "I cannot tell"]) {
      const [[, met]] = (await grade(verdictEquals("v", "yes"), text)) as [[string, boolean]]
      expect(verdictIs("yes")(run(text)), text).toBe(met)
      expect(readVerdict(text) === "yes", text).toBe(met)
    }
    expect(verdictIs("no", { words: { yes: "yes", no: "no" } })(run("no"))).toBe(true)
    expect(verdictIs("no", { words: { yes: "yes", no: "no" } })(run("No."))).toBe(false)
  })
})
