import { execFile } from "node:child_process"
import { appendFile, copyFile, cp, readdir, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import type { Fixture } from "../ports/fixture.ts"

const execFileAsync = promisify(execFile)

/** Name the diff is copied under at the repo root: prompts refer to it uniformly. */
export const DIFF_NAME = "eval-pr.diff"
/** Branch the applied diff is committed on. */
export const EVAL_BRANCH = "eval-pr"
/** Kept out of `git status` in the clone: the case material, never part of the reviewed change. */
const EXCLUDED = [DIFF_NAME, "eval-spec.md", ".claude/settings.local.json"]
/** Commits in the throw-away clone never sign and never run the host's hooks. */
const GIT_EVAL = ["-c", "user.name=eval", "-c", "user.email=eval@local", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"]

type Path = string | URL

interface GitRepoState {
  readonly url: string
  readonly ref: string
  readonly commit?: string
  readonly diff?: string
  readonly apply: boolean
  readonly overlay?: string
}

/**
 * Clones a repository into the workspace, as the harness, outside the agent sandbox (it uses the host git
 * credentials). Build it with {@link gitRepo}. Every method returns a new, immutable fixture.
 */
export class GitRepoFixture implements Fixture {
  readonly #state: GitRepoState

  /** @internal Use {@link gitRepo} instead. */
  constructor(state: GitRepoState) {
    this.#state = state
  }

  /** @example gitRepo("git@github.com:org/repo.git").at("5fb0133").description // "gitRepo(git@github.com:org/repo.git@5fb0133)" */
  get description(): string {
    const { url, ref, commit } = this.#state
    return `gitRepo(${url}@${commit ?? ref})`
  }

  /**
   * Branch to clone (default `main`), and the base branch the case is compared to.
   *
   * @example
   * gitRepo(url).ref("develop")
   */
  ref(ref: string): GitRepoFixture {
    return this.#with({ ref })
  }

  /**
   * Checks out an exact commit after cloning, for a state that does not move with the branch.
   *
   * @example
   * gitRepo(url).at("5fb0133ed74d2d17588ebdf87e639ad1b3d38f64")
   */
  at(commit: string): GitRepoFixture {
    return this.#with({ commit })
  }

  /**
   * Copies a diff to the repo root as `eval-pr.diff`, without applying it.
   *
   * @example
   * gitRepo(url).at(sha).diff(new URL("./diffs/pr-2827.diff", import.meta.url))
   */
  diff(path: Path): GitRepoFixture {
    return this.#with({ diff: toPath(path), apply: false })
  }

  /**
   * Applies a diff as one commit on the `eval-pr` branch, and points `origin/<ref>` at the base,
   * so that a tool reviewing "the current branch against the default one" sees exactly this diff.
   *
   * @example
   * gitRepo(url).at(sha).applyDiff(new URL("./diffs/x.diff", import.meta.url))
   */
  applyDiff(path: Path): GitRepoFixture {
    return this.#with({ diff: toPath(path), apply: true })
  }

  /**
   * Copies a directory onto the repo root and commits it on the base branch: part of the repo state
   * (a spec as `eval-spec.md`, a REVIEW.md), never of the reviewed diff.
   *
   * @example
   * gitRepo(url).at(sha).overlay(new URL("./overlays/x", import.meta.url))
   */
  overlay(path: Path): GitRepoFixture {
    return this.#with({ overlay: toPath(path) })
  }

  /**
   * Clones into the workspace directory; the sandbox removes it, so there is nothing to tear down.
   *
   * @example
   * await gitRepo(url).at(sha).applyDiff(diff).setup(workspace) // workspace.cwd is on branch eval-pr
   */
  async setup(workspace: { readonly cwd: string }): Promise<void> {
    const { url, ref, commit, diff, apply, overlay } = this.#state
    const dir = workspace.cwd
    await ensureEmpty(dir)
    const git = (...args: string[]) => run(dir, args)
    const commitAs = (message: string) => run(dir, ["commit", "-q", "-m", message], GIT_EVAL)
    await git("clone", "--quiet", "--depth", "1", "--branch", ref, url, ".")
    if (commit) {
      await git("fetch", "--quiet", "--depth", "1", "origin", commit)
      await git("checkout", "--quiet", commit)
    }
    // Copied before the overlay commit, as run.sh does: with an overlay, the base commit also tracks eval-pr.diff.
    // Kept for parity with the bash results; the exclude list only applies to untracked files.
    if (diff) await copyFile(await existing(diff, "diff"), join(dir, DIFF_NAME))
    if (apply || overlay) {
      await git("checkout", "-q", "-B", ref, "HEAD")
      if (overlay) {
        await cp(await existing(overlay, "overlay"), dir, { recursive: true })
        await git("add", "-A")
        await commitAs("eval: overlay du case")
      }
      // A shallow clone has no merge-base between an old commit and the real tip: pin origin/<ref> on the base
      // and neutralise fetch, so that a `git fetch origin main` run by the agent cannot move it.
      await git("update-ref", `refs/remotes/origin/${ref}`, "HEAD")
      await git("config", "remote.origin.fetch", "+refs/heads/__none__:refs/remotes/origin/__none__")
      if (apply) {
        await git("checkout", "-q", "-b", EVAL_BRANCH)
        await git("apply", "--index", "--whitespace=nowarn", DIFF_NAME)
        await commitAs("eval: apply case diff")
        await rm(join(dir, DIFF_NAME))
      }
    }
    await appendFile(join(dir, ".git", "info", "exclude"), `${EXCLUDED.join("\n")}\n`)
  }

  #with(patch: Partial<GitRepoState>): GitRepoFixture {
    return new GitRepoFixture({ ...this.#state, ...patch })
  }
}

/**
 * Starts a git repository fixture, cloned at `main` unless `.ref(...)` says otherwise.
 * Relative string paths resolve from the current directory: pass a `URL` to resolve them from the eval file.
 *
 * @example
 * c.fixture(gitRepo("git@github.com:org/repo.git").at("5fb0133").applyDiff(diff).overlay(overlay))
 */
export function gitRepo(url: string): GitRepoFixture {
  return new GitRepoFixture({ url, ref: "main", apply: false })
}

const toPath = (path: Path) => (path instanceof URL ? fileURLToPath(path) : resolve(path))

/** Runs `git <config> <args>`; errors show `args` only. */
async function run(cwd: string, args: string[], config: readonly string[] = []) {
  try {
    await execFileAsync("git", [...config, ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`)
  }
}

async function existing(path: string, what: string): Promise<string> {
  const found = await stat(path).then(
    () => true,
    () => false,
  )
  if (!found) throw new Error(`gitRepo ${what} not found: ${path}. Pass new URL("./x", import.meta.url) to resolve it from the eval file.`)
  return path
}

async function ensureEmpty(dir: string) {
  const entries = await readdir(dir).catch(() => [])
  if (entries.length > 0)
    throw new Error(`gitRepo clones into the workspace, which already holds ${entries.join(", ")}: declare gitRepo(...) first.`)
}
