import { describe, expect, it } from "vitest"
import { hostEnvironment } from "./host.ts"
import { gitIn, tempDir } from "#test/helpers.ts"

describe("hostEnvironment", () => {
  it("omits the branch on a detached HEAD, as in CI", async () => {
    const repo = await tempDir()
    const git = gitIn(repo)
    git("init", "-q")
    git("commit", "-q", "--allow-empty", "-m", "init")
    git("checkout", "-q", "--detach")

    const host = hostEnvironment(repo)
    expect(host.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(host).not.toHaveProperty("branch")
  })
})
