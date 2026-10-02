import type { SuiteDefinition } from "./model.ts"
import type { TrialPlan } from "./lifecycle.ts"

export interface MatrixOptions {
  /** Repetitions per case × variant, at least 1. */
  readonly repeat: number
  /** Restrict to these case ids; all cases when omitted. */
  readonly cases?: readonly string[] | undefined
  /** Restrict to these variant names; all variants when omitted. */
  readonly variants?: readonly string[] | undefined
}

/**
 * Expands a suite into trials, in matrix order: case, then variant, then repetition.
 * Throws when a filter names an unknown case or variant.
 *
 * @example
 * buildMatrix(definition, { repeat: 3, variants: ["baseline"] }).length // cases × 1 × 3
 */
export function buildMatrix(suite: SuiteDefinition, options: MatrixOptions): TrialPlan[] {
  const cases = pick(suite.cases, (c) => c.id, options.cases, "case", suite.name)
  const variants = pick(suite.variants, (v) => v.name, options.variants, "variant", suite.name)
  return cases.flatMap((testCase) =>
    variants.flatMap((variant) =>
      Array.from({ length: options.repeat }, (_, i) => ({
        suite: suite.name,
        sandboxAccess: suite.sandboxAccess,
        testCase,
        variant,
        trial: i + 1,
      })),
    ),
  )
}

function pick<T>(
  items: readonly T[],
  key: (item: T) => string,
  wanted: readonly string[] | undefined,
  kind: string,
  suite: string,
): readonly T[] {
  if (!wanted || wanted.length === 0) return items
  const known = items.map(key)
  const unknown = wanted.find((name) => !known.includes(name))
  if (unknown !== undefined) {
    throw new Error(`Unknown ${kind} "${unknown}" in suite "${suite}". Known ${kind}s: ${known.join(", ")}`)
  }
  return items.filter((item) => wanted.includes(key(item)))
}
