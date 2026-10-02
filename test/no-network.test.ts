import { describe, expect, it } from "vitest"
import { CREDENTIAL_ENV, takeNetworkAttempts } from "#test/setup.ts"

describe("test isolation (test/support/setup.ts)", () => {
  it("clears credential variables", () => {
    expect(Object.keys(process.env).filter((key) => CREDENTIAL_ENV.test(key))).toEqual([])
  })

  it("blocks outbound connections", async () => {
    await expect(fetch("http://example.com")).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/Network access is blocked in npm test/) },
    })
    // Taken here so that the setup's afterEach does not fail this test.
    expect(takeNetworkAttempts()).toEqual(["example.com:80"])
  })
})
