import { createHash } from "node:crypto"
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises"
import { basename, isAbsolute, join, relative } from "node:path"
import { z } from "zod"
import { isDirectory } from "../../../shared/fs.ts"

/** A plugin loaded from a directory of the host, copied into the sandbox home and passed with `--plugin-dir`. */
export interface DirectoryPlugin {
  readonly kind: "directory"
  /** Absolute path on the host. */
  readonly source: string
}

/** A plugin installed from a marketplace into the sandbox config directory, e.g. `caveman@JuliusBrussee/caveman`. */
export interface MarketplacePlugin {
  readonly kind: "marketplace"
  readonly plugin: string
  /** What `claude plugin marketplace add` accepts: `owner/repo`, a git URL or a path. */
  readonly marketplace: string
}

export type PluginRef = DirectoryPlugin | MarketplacePlugin

/** A plugin name without path nor marketplace, e.g. `sdlc`: looked up under the plugin roots. */
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Reads a variant plugin identifier. The syntax of `.plugins(...)` belongs to this adapter:
 * - a name, e.g. `sdlc`: the first `<root>/sdlc` directory among `roots` (`--plugin-root`);
 * - an absolute directory, e.g. `/repo/marketplace/plugins/sdlc`;
 * - `<plugin>@<marketplace source>`, e.g. `caveman@JuliusBrussee/caveman`.
 *
 * @example
 * parsePluginRef("caveman@JuliusBrussee/caveman") // { kind: "marketplace", plugin: "caveman", marketplace: "JuliusBrussee/caveman" }
 * parsePluginRef("sdlc", ["/repo/marketplace/plugins"]) // { kind: "directory", source: "/repo/marketplace/plugins/sdlc" }
 */
export function parsePluginRef(ref: string, roots: readonly string[] = []): PluginRef {
  if (isAbsolute(ref)) return { kind: "directory", source: ref }
  const at = ref.indexOf("@")
  if (at > 0 && at < ref.length - 1) return { kind: "marketplace", plugin: ref.slice(0, at), marketplace: ref.slice(at + 1) }
  if (PLUGIN_NAME.test(ref)) {
    const source = roots.map((root) => join(root, ref)).find(isDirectory)
    if (source) return { kind: "directory", source }
    const where = roots.length === 0 ? "no plugin root is configured" : `under ${roots.join(", ")}`
    throw new Error(
      `Plugin "${ref}" not found${roots.length === 0 ? ": " : " "}${where}. ` +
        `Pass --plugin-root <dir> (e.g. marketplace/plugins), an absolute directory, or <plugin>@<marketplace source>.`,
    )
  }
  throw new Error(
    `Plugin "${ref}" is neither a name, an absolute directory nor <plugin>@<marketplace source>: ` +
      `pass e.g. "sdlc" with --plugin-root, "/abs/path/to/plugin" or "caveman@JuliusBrussee/caveman".`,
  )
}

/** Runs one `claude ...` command for the plugin installer, e.g. `["plugin", "install", "x@y"]`. */
export type ClaudeCli = (args: readonly string[], what: string) => Promise<unknown>

/**
 * Adds a marketplace to the config directory `configDir` and returns the name it registered under,
 * read from `plugins/known_marketplaces.json` (the CLI names it, not the harness).
 *
 * @example
 * await addMarketplace("JuliusBrussee/caveman", "/tmp/ws/home/.claude", cli) // "caveman"
 */
export async function addMarketplace(source: string, configDir: string, cli: ClaudeCli): Promise<string> {
  const known = join(configDir, "plugins", "known_marketplaces.json")
  const names = async () => {
    const text = await readFile(known, "utf8").catch(() => "{}")
    return Object.keys(z.record(z.string(), z.unknown()).parse(JSON.parse(text)))
  }
  const before = new Set(await names())
  await cli(["plugin", "marketplace", "add", source, "--scope", "user"], `claude plugin marketplace add ${source}`)
  const added = (await names()).find((name) => !before.has(name))
  if (!added) throw new Error(`claude plugin marketplace add ${source} registered no marketplace in ${known}`)
  return added
}

/**
 * Where the n-th directory plugin is copied inside the sandbox home. The copy is what the agent loads,
 * so an OS sandbox hiding the host home still lets it read the plugin.
 *
 * @example
 * pluginCopyPath("/tmp/ws/home", 0, "/repo/plugins/sdlc") // "/tmp/ws/home/.proctor/plugins/0-sdlc"
 */
export function pluginCopyPath(home: string, index: number, source: string): string {
  return join(home, ".proctor", "plugins", `${index}-${basename(source)}`)
}

/**
 * Copies a directory plugin into the sandbox home, with an actionable error when it is missing.
 *
 * @example
 * await copyPlugin("/repo/plugins/sdlc", "/tmp/ws/home/.proctor/plugins/0-sdlc")
 */
export async function copyPlugin(source: string, target: string): Promise<void> {
  const isDir = await stat(source).then(
    (s) => s.isDirectory(),
    () => false,
  )
  if (!isDir) throw new Error(`Plugin directory not found: ${source}. Check the path given to .plugins(...).`)
  await mkdir(join(target, ".."), { recursive: true })
  await cp(source, target, { recursive: true })
}

/**
 * sha256 of the plugins that ran: the files of every directory plugin (relative path and content, sorted),
 * then the id of every marketplace plugin. A report without it cannot say which version it measured.
 *
 * @example
 * await pluginFingerprint(["/repo/plugins/sdlc"], ["caveman@caveman"]) // "9c1d…"
 */
export async function pluginFingerprint(directories: readonly string[], installed: readonly string[]): Promise<string> {
  const digest = createHash("sha256")
  for (const dir of directories) {
    const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
    for (const file of files) {
      digest.update(`${basename(dir)}/${relative(dir, file)}\0`)
      digest.update(await readFile(file))
    }
  }
  for (const id of installed) digest.update(`installed ${id}\n`)
  return digest.digest("hex")
}
