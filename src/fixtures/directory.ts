import { cp, lstat, readdir, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Fixture } from "../ports/fixture.ts"

/**
 * Copies a directory's content into the workspace, or into a sub-directory of it with `into`.
 * Teardown removes only what the copy created: what the workspace already had stays, including
 * files the copy overwrote. A relative string path is resolved from the current directory:
 * pass a `URL` to resolve it from the eval file instead.
 *
 * @example
 * c.fixture(directory(new URL("./hello", import.meta.url)))
 * c.fixture(directory(new URL("./repo", import.meta.url), { into: "repo" }))
 */
export function directory(source: string | URL, options: { into?: string } = {}): Fixture {
  const path = source instanceof URL ? fileURLToPath(source) : resolve(source)
  return {
    description: `directory(${path})`,
    setup: async (workspace) => {
      const exists = await stat(path).then(
        (s) => s.isDirectory(),
        () => false,
      )
      if (!exists) {
        throw new Error(`"${path}" is not a directory. Pass new URL("./dir", import.meta.url) to resolve it from the eval file.`)
      }
      const target = options.into ? join(workspace.cwd, options.into) : workspace.cwd
      const created = await missingPaths(path, target)
      await cp(path, target, { recursive: true })
      return async () => {
        await Promise.all(created.map((entry) => rm(entry, { recursive: true, force: true })))
      }
    },
  }
}

/** The top-most paths under `target` that copying `source` onto it will create. */
async function missingPaths(source: string, target: string): Promise<string[]> {
  const existing = await lstat(target).catch(() => undefined)
  if (!existing) return [target]
  if (!existing.isDirectory() || !(await stat(source)).isDirectory()) return []
  const entries = await readdir(source)
  return (await Promise.all(entries.map((e) => missingPaths(join(source, e), join(target, e))))).flat()
}
