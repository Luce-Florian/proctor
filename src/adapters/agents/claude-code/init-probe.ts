import type { HookEvent, InitEvent } from "./stream-parser.ts"

/** What the variant declared, hence what the session may load. */
export interface DeclaredComponents {
  /** Directories passed with `--plugin-dir`, as given to the CLI. */
  readonly pluginDirs: readonly string[]
  /** Installed plugin ids, `plugin@marketplace`. */
  readonly pluginIds: readonly string[]
  /** MCP server names passed with `--mcp-config`. */
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

/** MCP tools are named `mcp__<server>__<tool>`, the server name normalized to `[A-Za-z0-9_-]`. */
const toolPrefix = (server: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}__`

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
  const prefixes = declared.mcpServers.map(toolPrefix)
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
