import type { McpStub } from "../dsl/mcp-stub.ts"
import type { ToolCall } from "../ports/agent.ts"
import type { Grader } from "../ports/grader.ts"
import { matchesInput } from "../ports/mcp-stub-rules.mjs"
import type { McpAnsweredBy, McpInputPattern } from "../ports/mcp-stub.ts"
import { readCount, type CallCount } from "./tool-used.ts"

/** Which calls to a stub {@link mcpCalled} counts; every field narrows, none counts every call. */
export interface McpCallMatch<Tools extends string> {
  readonly tool?: Tools
  /** The pattern a stub rule uses: an object pattern, or a `RegExp` over the JSON of the input. */
  readonly input?: McpInputPattern
  /** `"fallback"`: the calls no rule of the case nor of the stub anticipated. */
  readonly answeredBy?: McpAnsweredBy
}

/**
 * Passes when the agent made between `min` (default 1) and `max` matching calls to `stub`, as the stub logged them
 * (`ToolCall.mcp`), whatever names the agent gives MCP tools. In a trial whose variant has no such stub, not
 * applicable: no criterion, so the variant without the server is not failed by construction. The verdict gives the
 * count, never an input or an answer.
 *
 * @example
 * c.expect(mcpCalled("reads-orders", pgsql, { tool: "get_object_details", input: { object_name: /^(public\.)?orders$/ } }))
 * c.expect(mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 }))
 */
export function mcpCalled<Tools extends string>(
  id: string,
  stub: McpStub<Tools>,
  match: McpCallMatch<Tools> = {},
  count: CallCount = {},
): Grader {
  const { server } = stub.toDefinition()
  const { min, max, range } = readCount(`mcpCalled("${id}")`, count)
  const checks = callChecks(server, match)
  const matches = (call: ToolCall) => checks.every((check) => check(call))
  return {
    id,
    grade: async ({ result, mcpStubs }) => {
      if (!mcpStubs.includes(server)) return { graderId: id, passed: true, criteria: [] }
      const calls = result.toolCalls.filter(matches).length
      const met = calls >= min && calls <= max
      return {
        graderId: id,
        passed: met,
        criteria: [{ id, met, why: `${calls} ${describeMatch(server, match)} call(s), expected ${range}` }],
      }
    },
  }
}

/** What a call must pass to count: each field of `match` narrows, an absent one accepts any call. */
function callChecks(server: string, match: McpCallMatch<string>): ((call: ToolCall) => boolean)[] {
  const isCallTo = (call: ToolCall) => call.mcp?.server === server
  const isToTool = (call: ToolCall) => match.tool === undefined || call.mcp?.tool === match.tool
  const isAnsweredBy = (call: ToolCall) => match.answeredBy === undefined || call.mcp?.answeredBy === match.answeredBy
  const hasInput = (call: ToolCall) => matchesInput(match.input, call.input)
  return [isCallTo, isToTool, isAnsweredBy, hasInput]
}

/** @example describeMatch("pgsql", { tool: "get_object_details", answeredBy: "fallback" }) // "pgsql get_object_details answered by fallback" */
function describeMatch(server: string, match: McpCallMatch<string>): string {
  const input = match.input && JSON.stringify(match.input, (_, value: unknown) => (value instanceof RegExp ? String(value) : value))
  return [server, match.tool, input, match.answeredBy && `answered by ${match.answeredBy}`].filter(Boolean).join(" ")
}
