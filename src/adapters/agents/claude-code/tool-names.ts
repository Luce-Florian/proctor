/**
 * What Claude Code calls every tool of an MCP server, e.g. in `--allowedTools`: `mcp__<server>`, the server name
 * normalized to `[A-Za-z0-9_-]`.
 *
 * @example
 * mcpServerTools("plugin:dbtools:pgsql") // "mcp__plugin_dbtools_pgsql"
 */
export const mcpServerTools = (server: string): string => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}`

/**
 * The prefix of the tools of an MCP server: Claude Code names them `mcp__<server>__<tool>`.
 *
 * @example
 * mcpToolPrefix("pgsql") // "mcp__pgsql__"
 */
export const mcpToolPrefix = (server: string): string => `${mcpServerTools(server)}__`
