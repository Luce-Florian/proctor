import { createHash } from "node:crypto"
import { readdir, readFile, readlink } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import pLimit from "p-limit"

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
