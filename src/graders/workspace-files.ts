import { createHash } from "node:crypto"
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import pLimit from "p-limit"

/**
 * Reads a file the agent left in its workspace, from the host: refuses a path outside `cwd` and any symbolic link on
 * the way (the file itself, or a directory above it), which the agent could point at a host secret that the verdict
 * would then print.
 *
 * @example
 * await readWorkspaceFile(workspace.cwd, "out/report.json")
 */
export async function readWorkspaceFile(cwd: string, path: string): Promise<string> {
  const outside = workspaceEscape(path)
  if (outside) throw new Error(outside)
  const file = resolve(cwd, path)
  const stat = await lstat(file).catch(() => undefined)
  if (!stat) throw new Error(`the agent left no file "${path}" in the workspace`)
  if (!stat.isFile()) throw new Error(`"${path}" is not a regular file (a symbolic link is never followed)`)
  // lstat only looks at the last component: a directory above it may be a link to the host.
  const [root, real] = await Promise.all([realpath(cwd), realpath(file)])
  if (!isInside(root, real)) throw new Error(`"${path}" resolves outside the workspace through a symbolic link, which is never followed`)
  return readFile(real, "utf8")
}

/**
 * Why `path` cannot name a file of a workspace, or `undefined` when it can: it must be relative and stay inside.
 *
 * @example
 * workspaceEscape("../secret.json") // '"../secret.json" is outside the workspace: give a path relative to it.'
 */
export function workspaceEscape(path: string): string | undefined {
  // Any root works, as long as ".." can leave it: the check is on the path alone.
  const root = join(sep, "workspace")
  const inside = !isAbsolute(path) && isInside(root, resolve(root, path))
  return inside ? undefined : `"${path}" is outside the workspace: give a path relative to it.`
}

const isInside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Content fingerprint of every file under a directory, keyed by relative path with `/` separators. */
export type Snapshot = ReadonlyMap<string, string>

/**
 * Fingerprints every file under `dir`, `.git/` excepted. A symbolic link is fingerprinted by its target, never followed.
 *
 * @example
 * const before = await snapshot(workspace.cwd) // Map { "src/a.ts" => "3f2a…", ... }
 */
export async function snapshot(dir: string): Promise<Snapshot> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries.filter((e) => (e.isFile() || e.isSymbolicLink()) && !isUnderGit(relative(dir, e.parentPath)))
  const limit = pLimit(SNAPSHOT_CONCURRENCY)
  const hashed = await Promise.all(
    files.map((entry) =>
      limit(async () => {
        const path = join(entry.parentPath, entry.name)
        const key = relative(dir, path).split(sep).join("/")
        const hash = entry.isSymbolicLink()
          ? `link:${await readlink(path)}`
          : createHash("sha256")
              .update(await readFile(path))
              .digest("hex")
        return [key, hash] as const
      }),
    ),
  )
  return new Map(hashed)
}

/** Files hashed at once: enough to overlap disk latency, few enough to stay under the open-files limit. */
const SNAPSHOT_CONCURRENCY = 32
const isUnderGit = (rel: string) => rel === ".git" || rel.startsWith(`.git${sep}`)

/**
 * Paths added, modified or deleted between two snapshots, sorted.
 *
 * @example
 * changedPaths(before, await snapshot(workspace.cwd)) // ["src/a.ts", "src/new.ts"]
 */
export function changedPaths(before: Snapshot, after: Snapshot): string[] {
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort()
}
