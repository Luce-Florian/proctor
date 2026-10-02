import type { Grader } from "../ports/grader.ts"
import type { Workspace } from "../ports/workspace.ts"
import { changedPaths, snapshot, type Snapshot } from "./workspace-files.ts"

/** A path relative to the workspace, or a pattern over such paths (with `/` separators). */
export type PathMatch = string | RegExp

const matchesPath = (path: string, match: PathMatch) => (typeof match === "string" ? path === match : path.search(match) !== -1)

/**
 * Snapshots the workspace right before the agent runs, then compares it after the run. Nothing is executed in the
 * workspace (no `git`): a repository the agent wrote into could run its hooks or filters on the host.
 */
function fileChanges(id: string, match: PathMatch, expectChange: boolean): Grader {
  const before = new WeakMap<Workspace, Snapshot>()
  return {
    id,
    prepare: async (workspace) => {
      before.set(workspace, await snapshot(workspace.cwd))
    },
    grade: async ({ workspace }) => {
      const initial = before.get(workspace)
      if (!initial) throw new Error(`${id}: no snapshot of the workspace was taken before the run.`)
      before.delete(workspace)
      const changed = changedPaths(initial, await snapshot(workspace.cwd)).filter((path) => matchesPath(path, match))
      const met = expectChange ? changed.length > 0 : changed.length === 0
      const listed = changed.slice(0, 10).join(", ") + (changed.length > 10 ? `, … (${changed.length - 10} more)` : "")
      const why =
        changed.length === 0 ? `no file matching ${match} changed` : `${changed.length} file(s) matching ${match} changed: ${listed}`
      return { graderId: id, passed: met, criteria: [{ id, met, why }] }
    },
  }
}

/**
 * Passes when the agent added, modified or deleted at least one file matching `match` in its workspace,
 * `.git/` excepted.
 *
 * @example
 * c.expect(fileChanged("fixes-finder", "src/Finders/BetaWaitlistRegistrationsFinder.cs"))
 */
export function fileChanged(id: string, match: PathMatch): Grader {
  return fileChanges(id, match, true)
}

/**
 * Passes when no file matching `match` changed in the workspace: e.g. a review must not edit the code.
 *
 * @example
 * c.expect(fileUnchanged("review-is-readonly", /^src\//))
 */
export function fileUnchanged(id: string, match: PathMatch): Grader {
  return fileChanges(id, match, false)
}
