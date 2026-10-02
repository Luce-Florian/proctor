import { describe, expect, it } from "vitest"
import { suite } from "../dsl/suite.ts"
import { limits } from "./limits.ts"
import { criteriaOf } from "#test/graders.ts"

describe("limits", () => {
  it("checks the cost and duration of the agent under test", async () => {
    const grader = limits().maxCostUsd(3).maxDuration("10m")

    expect(await criteriaOf(grader, { costUsd: 1.2, durationMs: 90_000 })).toEqual([
      ["max-cost-usd", true, "$1.200 spent, limit $3"],
      ["max-duration", true, "90.0s, limit 10m"],
    ])
    expect(await criteriaOf(grader, { durationMs: 700_000 })).toEqual([
      ["max-cost-usd", false, "the agent reported no cost, so the limit cannot be checked"],
      ["max-duration", false, "700.0s, limit 10m"],
    ])
    expect(() => limits().maxCostUsd(0)).toThrow("maxCostUsd expects a positive number of dollars")
  })

  it("is not a grader before a limit is set", () => {
    const build = () =>
      suite("s")
        .variant("v", (v) => v.prompt("p"))
        // @ts-expect-error limits() without any limit is not a grader
        .case("c", (c) => c.expect(limits()))
    expect(build).toBeTypeOf("function")
  })
})
