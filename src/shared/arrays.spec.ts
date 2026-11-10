import { describe, expect, it } from "vitest"
import { duplicates } from "./arrays.ts"

describe("duplicates", () => {
  it("finds nothing in distinct values", () => {
    expect(duplicates(["pgsql", "tickets"])).toEqual([])
  })

  it("lists a value repeated several times once", () => {
    expect(duplicates(["pgsql", "tickets", "pgsql", "pgsql"])).toEqual(["pgsql"])
  })

  it("lists the repeated values in the order of their first repeat", () => {
    expect(duplicates(["pgsql", "tickets", "tickets", "pgsql"])).toEqual(["tickets", "pgsql"])
  })
})
