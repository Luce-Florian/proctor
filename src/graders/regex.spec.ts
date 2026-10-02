import { describe, expect, it } from "vitest"
import { regex } from "./regex.ts"
import { gradeContext } from "#test/helpers.ts"

describe("regex grader", () => {
  const grade = (pattern: RegExp, finalText: string) => regex("greets", pattern).grade(gradeContext({ finalText }))

  it("passes on a match and names the criterion by its id", async () => {
    expect(await grade(/hello/i, "Hello world")).toEqual({
      graderId: "greets",
      passed: true,
      criteria: [{ id: "greets", met: true, why: "final text matches /hello/i" }],
    })
  })

  it("fails without a match", async () => {
    expect((await grade(/hello/, "bye")).passed).toBe(false)
  })

  it("is stateless with a global regex", async () => {
    const pattern = /hello/g
    expect((await grade(pattern, "hello")).passed).toBe(true)
    expect((await grade(pattern, "hello")).passed).toBe(true)
  })
})
