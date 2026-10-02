import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { gitRepo } from "./git-repo.ts"
import { gitIn, tempDir } from "#test/helpers.ts"

/** An origin repository with two commits on main, and the case material next to it. */
async function origin() {
  const root = await tempDir()
  const repo = join(root, "origin")
  await mkdir(repo)
  const git = gitIn(repo)
  git("init", "-q", "-b", "main")
  await writeFile(join(repo, "app.ts"), "export const x = 1\n")
  git("add", "-A")
  git("commit", "-q", "-m", "base")
  const base = git("rev-parse", "HEAD")
  await writeFile(join(repo, "later.ts"), "later\n")
  git("add", "-A")
  git("commit", "-q", "-m", "later")
  const diff = join(root, "case.diff")
  await writeFile(diff, "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const x = 1\n+export const x = 2\n")
  const overlay = join(root, "overlay")
  await mkdir(overlay)
  await writeFile(join(overlay, "eval-spec.md"), "# spec\n")
  return { url: `file://${repo}`, base, diff, overlay }
}

describe("gitRepo fixture (port of run.sh)", () => {
  it("clones at a commit, commits the overlay on the base, applies the diff on eval-pr, and pins origin/main", async () => {
    const { url, base, diff, overlay } = await origin()
    const cwd = await tempDir()

    await gitRepo(url).at(base).applyDiff(diff).overlay(overlay).setup({ cwd })

    const git = gitIn(cwd)
    expect(git("branch", "--show-current")).toBe("eval-pr")
    expect(git("log", "--format=%s", "main")).toBe("eval: overlay du case\nbase")
    expect(git("rev-parse", "origin/main")).toBe(git("rev-parse", "main"))
    expect(git("diff", "--name-only", "origin/main...HEAD")).toBe("app.ts")
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("export const x = 2\n")
    expect(await readFile(join(cwd, "eval-spec.md"), "utf8")).toBe("# spec\n")
    expect(git("config", "remote.origin.fetch")).toBe("+refs/heads/__none__:refs/remotes/origin/__none__")
    expect(await readFile(join(cwd, ".git", "info", "exclude"), "utf8")).toContain(
      "eval-pr.diff\neval-spec.md\n.claude/settings.local.json\n",
    )
  })

  it("only copies the diff as eval-pr.diff when it is not applied", async () => {
    const { url, base, diff } = await origin()
    const cwd = await tempDir()

    await gitRepo(url).at(base).diff(diff).setup({ cwd })

    expect(gitIn(cwd)("rev-parse", "HEAD")).toBe(base)
    expect(await readFile(join(cwd, "eval-pr.diff"), "utf8")).toContain("+export const x = 2")
    expect(gitIn(cwd)("status", "--porcelain")).toBe("")
  })

  it("names what failed and how to fix a missing file", async () => {
    const { url } = await origin()

    await expect(
      gitRepo(url)
        .ref("nope")
        .setup({ cwd: await tempDir() }),
    ).rejects.toThrow(/^git clone .* failed: /)
    await expect(
      gitRepo(url)
        .diff("/no/such.diff")
        .setup({ cwd: await tempDir() }),
    ).rejects.toThrow("gitRepo diff not found: /no/such.diff. Pass new URL")
  })

  it("describes itself for error messages and is immutable", () => {
    const repo = gitRepo("git@github.com:org/repo.git")
    expect(repo.at("5fb0133").description).toBe("gitRepo(git@github.com:org/repo.git@5fb0133)")
    expect(repo.description).toBe("gitRepo(git@github.com:org/repo.git@main)")
  })
})
