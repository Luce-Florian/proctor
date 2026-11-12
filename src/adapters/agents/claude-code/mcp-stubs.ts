import { join } from "node:path"
import { z } from "zod"
import type { StubCallTarget } from "../../mcp-stub/call-log.ts"
import type { StubEntry } from "../../mcp-stub/materialize.ts"
import { readJson } from "./plugins.ts"
import { mcpToolPrefix } from "./tool-names.ts"

/** A plugin the session loads, and the MCP servers its `.mcp.json` declares, which `--strict-mcp-config` never starts. */
export interface PluginServers {
  /** The plugin name, as Claude Code names its servers: `plugin:<plugin>:<server>`. */
  readonly plugin: string
  readonly servers: readonly string[]
}

/** A stub, and the server name Claude Code sees it under, e.g. `plugin:dbtools:pgsql` for the stub `pgsql`. */
export interface ClaudeStub {
  readonly name: string
  readonly entry: StubEntry
}

const namedManifest = z.object({ name: z.string().min(1) })
/** `mcpServers` of `plugin.json`: the servers inline, or the path(s), relative to the plugin, of files that declare them. */
const manifestServers = z.object({ mcpServers: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]) })
const serversFile = z.object({ mcpServers: z.record(z.string(), z.unknown()) })

/**
 * The name of the plugin in `dir` and the MCP servers it declares, as Claude Code reads them: in its `.mcp.json`, and in
 * the `mcpServers` of its `.claude-plugin/plugin.json`, inline or as the path(s) of files shaped like `.mcp.json`.
 *
 * @example
 * await pluginServers("/ws/home/.proctor/plugins/0-dbtools", "dbtools") // { plugin: "dbtools", servers: ["pgsql"] }
 */
export async function pluginServers(dir: string, fallbackName: string): Promise<PluginServers> {
  const manifest = await readJson(join(dir, ".claude-plugin", "plugin.json"))
  const named = namedManifest.safeParse(manifest)
  const declared = await Promise.all([serversIn(join(dir, ".mcp.json")), manifestServerNames(dir, manifest)])
  return { plugin: named.success ? named.data.name : fallbackName, servers: [...new Set(declared.flat())] }
}

/** The servers the `mcpServers` of a plugin manifest declares, inline or in the files it points to. */
async function manifestServerNames(dir: string, manifest: unknown): Promise<string[]> {
  const parsed = manifestServers.safeParse(manifest)
  if (!parsed.success) return []
  const { mcpServers } = parsed.data
  if (typeof mcpServers === "string") return serversIn(join(dir, mcpServers))
  if (Array.isArray(mcpServers)) return (await Promise.all(mcpServers.map((path) => serversIn(join(dir, path))))).flat()
  return Object.keys(mcpServers)
}

/** The servers a file shaped like `.mcp.json` declares, none when it does not exist. */
async function serversIn(file: string): Promise<string[]> {
  const parsed = serversFile.safeParse(await readJson(file))
  return parsed.success ? Object.keys(parsed.data.mcpServers) : []
}

/**
 * Names each stub as Claude Code will see it: after the plugin server it replaces, `plugin:<plugin>:<server>`, when a
 * loaded plugin declares a server of the stub's name, so that the skill finds the tool names it expects; its own name
 * otherwise. Throws when two loaded plugins declare that server.
 *
 * @example
 * claudeStubName("pgsql", [{ plugin: "dbtools", servers: ["pgsql"] }]) // "plugin:dbtools:pgsql"
 * claudeStubName("pgsql", []) // "pgsql"
 */
export function claudeStubName(server: string, plugins: readonly PluginServers[]): string {
  const declaring = plugins.filter((plugin) => plugin.servers.includes(server)).map((plugin) => plugin.plugin)
  const [plugin, ...others] = declaring
  if (plugin === undefined) return server
  if (others.length > 0) {
    const names = declaring.map((name) => `"${name}"`).join(" and ")
    throw new Error(`mcpStub "${server}": plugins ${names} both declare this server; load only one`)
  }
  return `plugin:${plugin}:${server}`
}

/**
 * Reads which stub and tool a call addressed from its Claude Code name, `mcp__<server>__<tool>`: the stub's own name, as
 * the suite declares it, and the tool; `undefined` for a call to anything else. The longest server name wins, so that
 * `mcp__a__b__x` goes to the stub `a__b`, not `a`.
 *
 * @example
 * const parse = stubToolParser([{ name: "plugin:dbtools:pgsql", entry }])
 * parse("mcp__plugin_dbtools_pgsql__get_object_details") // { server: "pgsql", tool: "get_object_details" }
 */
export function stubToolParser(stubs: readonly ClaudeStub[]): (toolName: string) => StubCallTarget | undefined {
  const byLongestPrefix = stubs
    .map((stub) => ({ server: stub.entry.name, prefix: mcpToolPrefix(stub.name) }))
    .sort((first, second) => second.prefix.length - first.prefix.length)
  return (toolName) => {
    const stub = byLongestPrefix.find(({ prefix }) => toolName.startsWith(prefix))
    return stub && { server: stub.server, tool: toolName.slice(stub.prefix.length) }
  }
}
