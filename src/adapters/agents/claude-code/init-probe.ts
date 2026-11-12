import type { ClaudeStub } from "./mcp-stubs.ts"
import type { HookEvent, InitEvent } from "./stream-parser.ts"
import { mcpToolPrefix } from "./tool-names.ts"

/** What the variant declared, hence what the session may load. */
export interface DeclaredComponents {
  /** Directories passed with `--plugin-dir`, as given to the CLI. */
  readonly pluginDirs: readonly string[]
  /** Installed plugin ids, `plugin@marketplace`. */
  readonly pluginIds: readonly string[]
  /** MCP server names passed with `--mcp-config`, stubs included. */
  readonly mcpServers: readonly string[]
  /** Hook events of the variant settings, e.g. `SessionStart`. */
  readonly hookEvents: readonly string[]
}

/** Raised when the session loaded something the variant did not declare: the trial is `other`, never graded. */
export class IsolationError extends Error {
  override readonly name = "IsolationError"
}

/** Plugins Claude Code ships with, always reported by `system/init`. */
const isBuiltin = (plugin: { path?: string; source?: string }) => plugin.path === "builtin" || plugin.source?.endsWith("@builtin")

/**
 * Compares what `system/init` reports with what the variant declared. Returns one line per problem:
 * an undeclared MCP server, MCP tool or plugin (a leak of the host configuration), or a declared plugin
 * that did not load (e.g. unreadable under the sandbox). An empty list means the session is as declared.
 *
 * @example
 * probeInit(init, { pluginDirs: [], pluginIds: [], mcpServers: [] })
 * // ["undeclared MCP server \"claude.ai Gmail\"", "undeclared MCP tool mcp__claude_ai_Gmail__send_message"]
 */
export function probeInit(init: InitEvent, declared: DeclaredComponents): string[] {
  const problems: string[] = []
  const servers = new Set(declared.mcpServers)
  for (const server of init.mcp_servers ?? []) {
    if (!servers.has(server.name)) problems.push(`undeclared MCP server "${server.name}"`)
  }
  const prefixes = declared.mcpServers.map(mcpToolPrefix)
  for (const tool of init.tools ?? []) {
    if (tool.startsWith("mcp__") && !prefixes.some((p) => tool.startsWith(p))) problems.push(`undeclared MCP tool ${tool}`)
  }

  const loaded = (init.plugins ?? []).filter((p) => !isBuiltin(p))
  const dirs = new Set(declared.pluginDirs)
  const ids = new Set(declared.pluginIds)
  for (const plugin of loaded) {
    const allowed = (plugin.path !== undefined && dirs.has(plugin.path)) || (plugin.source !== undefined && ids.has(plugin.source))
    if (!allowed) problems.push(`undeclared plugin "${plugin.source ?? plugin.name}" (${plugin.path ?? "no path"})`)
  }
  for (const dir of declared.pluginDirs) {
    if (!loaded.some((p) => p.path === dir)) problems.push(`declared plugin ${dir} did not load: is it readable inside the sandbox?`)
  }
  for (const id of declared.pluginIds) {
    if (!loaded.some((p) => p.source === id)) problems.push(`declared plugin ${id} did not load`)
  }
  return problems
}

/**
 * Compares the hooks that started before `system/init` (only `SessionStart` ones do) with what the variant declared.
 * A variant with plugins is not checked: a plugin may bring its own hooks, and the event does not say whose it is.
 * Skills and agents are not probed: `system/init` lists them without telling built-in ones apart.
 *
 * @example
 * probeHooks(stream.hooks, { pluginDirs: [], pluginIds: [], mcpServers: [], hookEvents: [] })
 * // ['undeclared hook "SessionStart:startup": neither in the variant settings nor from a plugin (host managed settings?)']
 */
export function probeHooks(hooks: readonly HookEvent[], declared: DeclaredComponents): string[] {
  if (declared.pluginDirs.length > 0 || declared.pluginIds.length > 0) return []
  const events = new Set(declared.hookEvents)
  return hooks
    .filter((hook) => hook.hook_event === undefined || !events.has(hook.hook_event))
    .map(
      (hook) =>
        `undeclared hook "${hook.hook_name ?? hook.hook_event}": neither in the variant settings nor from a plugin (host managed settings?)`,
    )
}

/**
 * The `system/init` status of an MCP server still connecting: the probe cannot tell yet whether a stub in that state
 * will serve, and the stub's own log decides after the run.
 */
const PENDING = "pending"

/**
 * Checks that `system/init` shows every MCP stub connected with all its tools: a stub that failed to start would let the
 * run measure the skill without its server. Stopping here saves the run's tokens; the stub's own log decides after the
 * run anyway, so a stub still connecting is not stopped. Returns one line per problem.
 *
 * @example
 * probeStubs(init, [{ name: "pgsql", entry: { name: "pgsql", command: "node", args: [], tools: ["get_object_details"] } }])
 * // ['MCP stub "pgsql" is failed, not connected']
 */
export function probeStubs(init: InitEvent, stubs: readonly ClaudeStub[]): string[] {
  const listed = new Set(init.tools ?? [])
  return stubs.flatMap(({ name, entry }) => {
    const status = init.mcp_servers?.find((server) => server.name === name)?.status ?? "absent"
    if (status === PENDING) return []
    if (status !== "connected") return [`MCP stub "${entry.name}" is ${status}, not connected`]
    const missing = entry.tools.map((tool) => `${mcpToolPrefix(name)}${tool}`).filter((tool) => !listed.has(tool))
    return missing.length > 0 ? [`MCP stub "${entry.name}" lacks ${missing.join(", ")}`] : []
  })
}
