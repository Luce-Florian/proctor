import { describe, expect, it } from "vitest"
import { parseJsonOrUndefined } from "./text.ts"

describe("parseJsonOrUndefined", () => {
  it("reads a JSON text", () => {
    expect(parseJsonOrUndefined('{"event":"initialize"}')).toEqual({ event: "initialize" })
  })

  it("reads nothing from a text that is not JSON", () => {
    expect(parseJsonOrUndefined("not json")).toBeUndefined()
  })
})
