import type { Grader } from "../ports/grader.ts"

/**
 * Passes when the agent's final text matches `pattern`. The criterion id is `id`.
 *
 * @example
 * c.expect(regex("says-hello", /hello/i))
 */
export function regex(id: string, pattern: RegExp): Grader {
  return {
    id,
    grade: async ({ result }) => {
      // `search` ignores the `g` flag and `lastIndex`, so the grader stays stateless.
      const met = result.finalText.search(pattern) !== -1
      const why = met ? `final text matches ${pattern}` : `final text does not match ${pattern}`
      return { graderId: id, passed: met, criteria: [{ id, met, why }] }
    },
  }
}
