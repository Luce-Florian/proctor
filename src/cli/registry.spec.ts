import { describe, expect, it } from "vitest"
import { sandboxIdFor } from "./registry.ts"

describe("sandbox selection", () => {
  it("defaults to srt for any real agent, and to the fake sandbox for the fake agent", () => {
    expect(sandboxIdFor("claude-code", undefined)).toBe("srt")
    expect(sandboxIdFor("fake", undefined)).toBe("fake")
    expect(sandboxIdFor("claude-code", "local-temp")).toBe("local-temp")
  })
})
