import { describe, expect, it } from "vitest"
import { parseDuration, type Duration } from "./duration.ts"

describe("parseDuration", () => {
  it.each([
    ["500ms", 500],
    ["30s", 30_000],
    ["1.5s", 1_500],
    ["10m", 600_000],
    ["1h", 3_600_000],
  ] as const)("parses %s", (input, expected) => {
    expect(parseDuration(input)).toBe(expected)
  })

  it("rejects a duration without unit with an actionable message", () => {
    expect(() => parseDuration("10" as Duration)).toThrow(/use a number followed by ms, s, m or h/)
  })

  it("rejects a duration that setTimeout cannot hold", () => {
    expect(() => parseDuration("600h")).toThrow(/at most 596h/)
  })

  it("rejects a zero duration", () => {
    expect(() => parseDuration("0s")).toThrow(/greater than zero/)
  })
})
