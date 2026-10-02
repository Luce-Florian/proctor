/**
 * Fingerprints the parts of `~/.claude` that an evaluation campaign must leave untouched.
 *
 * @example
 * npm run fingerprint:claude-home -- --save before.json
 * # ... campaign ...
 * npm run fingerprint:claude-home -- --compare before.json   # exit 1 and lists what changed
 */
import { createHash } from "node:crypto"
import { lstat, readdir, readFile, readlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

/** Paths relative to the Claude home, hashed in this order. */
export const WATCHED = ["settings.json", "plugins", "plugins/known_marketplaces.json"] as const

/** sha256 per watched path, or `"absent"`. */
export type Fingerprint = Record<string, string>

/**
 * Hashes every watched path under `claudeHome`; a directory hashes its whole tree.
 *
 * @example
 * await fingerprint(join(homedir(), ".claude")) // { "settings.json": "3f2a…", plugins: "9c1d…", … }
 */
export async function fingerprint(claudeHome: string): Promise<Fingerprint> {
  const entries = await Promise.all(WATCHED.map(async (path) => [path, await hash(join(claudeHome, path))] as const))
  return Object.fromEntries(entries)
}

/**
 * The watched paths whose hash differs.
 *
 * @example
 * changedPaths(before, await fingerprint(home)) // ["plugins"]
 */
export function changedPaths(before: Fingerprint, after: Fingerprint): string[] {
  return WATCHED.filter((path) => before[path] !== after[path])
}

async function hash(path: string): Promise<string> {
  const stats = await lstat(path).catch(() => undefined)
  if (!stats) return "absent"
  const digest = createHash("sha256")
  if (stats.isSymbolicLink()) digest.update(`link ${await readlink(path)}`)
  else if (stats.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) digest.update(`${entry}\0${await hash(join(path, entry))}\n`)
  } else digest.update(await readFile(path))
  return digest.digest("hex")
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { home: { type: "string" }, save: { type: "string" }, compare: { type: "string" } },
  })
  const current = await fingerprint(values.home ?? join(homedir(), ".claude"))
  if (values.save) await writeFile(values.save, `${JSON.stringify(current, null, 2)}\n`)
  if (!values.compare) {
    if (!values.save) process.stdout.write(`${JSON.stringify(current, null, 2)}\n`)
    return 0
  }
  const changed = changedPaths(JSON.parse(await readFile(values.compare, "utf8")) as Fingerprint, current)
  process.stdout.write(changed.length === 0 ? "~/.claude unchanged\n" : `~/.claude changed: ${changed.join(", ")}\n`)
  return changed.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
