import type { Grader } from "../ports/grader.ts"
import { describeMatch, matchesCall, type ToolCallMatch } from "./tool-calls.ts"

/** How many matching calls are expected. */
export interface CallCount {
  /** Default 1. */
  readonly min?: number
  readonly max?: number
}

/**
 * Passes when the agent made between `min` (default 1) and `max` matching tool calls, read from
 * `AgentRunResult.toolCalls`. The verdict gives the count, never an input or output.
 *
 * @example
 * c.expect(toolUsed("reads-rules", { tool: "Read", input: /\.claude\/rules\// }))
 * c.expect(toolUsed("no-web", { tool: /^Web/ }, { min: 0, max: 0 }))
 */
export function toolUsed(id: string, match: ToolCallMatch, count: CallCount = {}): Grader {
  const { min = 1, max = Number.POSITIVE_INFINITY } = count
  if (!Number.isInteger(min) || min < 0 || max < min)
    throw new Error(`toolUsed("${id}"): expected 0 <= min <= max, got min ${min}, max ${max}.`)
  const range = describeRange(min, max)
  return {
    id,
    grade: async ({ result }) => {
      const calls = result.toolCalls.filter((call) => matchesCall(call, match)).length
      const met = calls >= min && calls <= max
      return { graderId: id, passed: met, criteria: [{ id, met, why: `${calls} ${describeMatch(match)} call(s), expected ${range}` }] }
    },
  }
}

function describeRange(min: number, max: number): string {
  if (max === Number.POSITIVE_INFINITY) return `at least ${min}`
  return min === max ? `exactly ${min}` : `${min} to ${max}`
}
