import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { legacyJsonLoader } from "./legacy-json.ts"
import { fixturePath } from "#test/helpers.ts"

const demo = fixturePath("legacy", "demo")

describe("legacy JSON loader", () => {
  it("recognises a theme directory, not a file", () => {
    expect(legacyJsonLoader.canLoad(demo)).toBe(true)
    expect(legacyJsonLoader.canLoad(join(demo, "cases"))).toBe(false)
  })
})
