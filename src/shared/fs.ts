import { constants, existsSync, realpathSync, statSync } from "node:fs"
import { open, realpath, type FileHandle } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/**
 * Whether `path` exists and is a directory; never throws.
 *
 * @example
 * isDirectory("evals/my-theme/cases") // true
 */
export function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

/**
 * Real path of a directory, or the path itself when it does not resolve (macOS temp dirs live under `/private/var`).
 *
 * @example
 * realPath("/var/folders/x") // "/private/var/folders/x"
 */
export function realPath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/** What {@link readWorkspaceFile} accepts beyond the path. */
export interface WorkspaceFileOptions {
  /** Largest size read, in bytes; a larger file is refused, and never read past this size. Default: no limit. */
  readonly maxBytes?: number
}

/** Opens the file itself, never a link in its place, and never waits for a FIFO's writer. */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

/**
 * Reads, from the host, a file the agent could write: refuses a path outside `root`, anything but a regular file (a
 * FIFO or a device would hang the read), any symbolic link on the way (the file itself, or a directory above it that
 * leaves `root`), which the agent could point at a host secret, and a file over `maxBytes`. The checks and the read go
 * through one open handle, so a file swapped or grown in between is still caught.
 * Remaining limit: a directory above the file swapped for a link between the `realpath` check and the open.
 *
 * @example
 * await readWorkspaceFile(workspace.cwd, "out/report.json")
 * await readWorkspaceFile(workspace.home, ".proctor/mcp/pgsql.jsonl", { maxBytes: 4 * 1024 * 1024 })
 */
export async function readWorkspaceFile(root: string, path: string, options: WorkspaceFileOptions = {}): Promise<string> {
  const outside = workspaceEscape(path)
  if (outside) throw new Error(outside)
  const { maxBytes = Number.POSITIVE_INFINITY } = options
  const file = resolve(root, path)
  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(dirname(file)).catch(() => undefined)])
  if (realParent === undefined) throw new Error(missingFile(path))
  if (realParent !== realRoot && !isInside(realRoot, realParent)) {
    throw new Error(`"${path}" resolves outside the workspace through a symbolic link, which is never followed`)
  }
  const handle = await open(join(realParent, basename(file)), OPEN_FLAGS).catch((error: unknown) => {
    throw openError(error, path)
  })
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(notRegularFile(path))
    if (stat.size > maxBytes) throw new Error(overSize(path, stat.size, maxBytes))
    if (maxBytes === Number.POSITIVE_INFINITY) return await handle.readFile("utf8")
    // One byte past what the stat saw, so a file that grew since is caught by the size check below.
    const content = await readAtMost(handle, Math.min(stat.size, maxBytes) + 1)
    if (content.length > maxBytes) throw new Error(overSize(path, content.length, maxBytes))
    return content.toString("utf8")
  } finally {
    await handle.close()
  }
}

const missingFile = (path: string) => `the agent left no file "${path}" in the workspace`
const notRegularFile = (path: string) => `"${path}" is not a regular file (a symbolic link is never followed)`
const overSize = (path: string, size: number, maxBytes: number) => `"${path}" holds ${size} bytes, over the ${maxBytes} bytes it may hold`

/** The error of opening `path`: missing, or a symbolic link refused by `O_NOFOLLOW` (`ELOOP`); else as Node threw it. */
function openError(error: unknown, path: string): unknown {
  const code = error instanceof Error && "code" in error ? error.code : undefined
  if (code === "ENOENT") return new Error(missingFile(path))
  if (code === "ELOOP") return new Error(notRegularFile(path))
  return error
}

/** Reads from `handle` until its end or `limit` bytes, whichever comes first. */
async function readAtMost(handle: FileHandle, limit: number): Promise<Buffer> {
  const buffer = Buffer.alloc(limit)
  let total = 0
  while (total < limit) {
    const { bytesRead } = await handle.read(buffer, total, limit - total, null)
    if (bytesRead === 0) break
    total += bytesRead
  }
  return buffer.subarray(0, total)
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
