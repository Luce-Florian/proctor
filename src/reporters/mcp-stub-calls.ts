import type { ToolCall } from "../ports/agent.ts"
import type { CtrfTest } from "./ctrf-types.ts"
import { extraOf } from "./aggregates.ts"

/** How many calls of a trial the MCP stubs answered, and how many of those a fallback answered. */
export interface StubCallCounts {
  readonly calls: number
  readonly fallbacks: number
}

/**
 * Counts the calls the MCP stubs answered; `undefined` when they answered none, e.g. in a trial without stub.
 *
 * @example
 * stubCallCounts(trial.agentResult.toolCalls) // { calls: 3, fallbacks: 1 }
 */
export function stubCallCounts(toolCalls: readonly ToolCall[]): StubCallCounts | undefined {
  const answered = toolCalls.filter((call) => call.mcp !== undefined)
  if (answered.length === 0) return undefined
  return { calls: answered.length, fallbacks: answered.filter((call) => call.mcp?.answeredBy === "fallback").length }
}

/**
 * What the reports say of a trial where a fallback answered a stub call.
 *
 * @example
 * unanticipatedCalls(2) // "2 MCP stub call(s) answered by a fallback: the agent asked something the case did not anticipate; …"
 */
export const unanticipatedCalls = (fallbacks: number): string =>
  `${fallbacks} MCP stub call(s) answered by a fallback: the agent asked something the case did not anticipate; the case may need a rule`

/**
 * The trials of a CTRF document where a fallback answered a stub call, by name, with the note the reports show.
 *
 * @example
 * unanticipatedCallNotes(report.results.tests) // [{ trial: "index-exists [with-pgsql] #1", note: "1 MCP stub call(s) answered by a fallback: …" }]
 */
export function unanticipatedCallNotes(tests: readonly CtrfTest[]): { readonly trial: string; readonly note: string }[] {
  return tests.flatMap((test) => {
    const fallbacks = extraOf(test).mcpStubFallbacks ?? 0
    return fallbacks > 0 ? [{ trial: test.name, note: unanticipatedCalls(fallbacks) }] : []
  })
}
