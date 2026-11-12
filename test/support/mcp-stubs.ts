import type { McpStubDefinition, McpToolDefinition } from "@fluce/proctor"

/**
 * A stub tool with an object input schema and no rule: a test adds only the rules, description or fallback it is about.
 *
 * @example
 * stubTool("get_object_details", { otherwise: { content: "relation does not exist", isError: true } })
 */
export const stubTool = (name: string, patch: Partial<McpToolDefinition> = {}): McpToolDefinition => ({
  name,
  inputSchema: { type: "object" },
  rules: [],
  ...patch,
})

/**
 * A stub definition serving `tools`.
 *
 * @example
 * stub("pgsql", stubTool("list_instances"), stubTool("get_object_details"))
 */
export const stub = (server: string, ...tools: McpToolDefinition[]): McpStubDefinition => ({ server, tools })
