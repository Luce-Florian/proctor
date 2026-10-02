import { execFileSync } from "node:child_process"
import { platform, release } from "node:os"
import type { HostEnvironment } from "../ports/run.ts"

/**
 * Commit, branch and OS of the host, for traceability. Git facts are omitted outside a repository,
 * and the branch on a detached HEAD (as in CI), where git only answers `HEAD`.
 *
 * @example
 * hostEnvironment(process.cwd()) // { commit: "5d298f6...", branch: "main", osPlatform: "darwin", osRelease: "25.2.0" }
 */
export function hostEnvironment(cwd: string): HostEnvironment {
  let commit: string | undefined
  let branch: string | undefined
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    ;[commit, branch] = out.trim().split("\n")
  } catch {
    // Not a git repository: git facts are omitted.
  }
  const named = branch && branch !== "HEAD" ? { branch } : {}
  return { ...(commit && { commit }), ...named, osPlatform: platform(), osRelease: release() }
}
