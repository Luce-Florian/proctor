import type { CtrfReport, CtrfStatus, CtrfTest, CtrfTrialExtra } from "./ctrf-types.ts"

/** Variant the others are compared with, unless the run says otherwise (`--baseline`). */
export const DEFAULT_BASELINE = "baseline"

/** Mean and sample standard deviation of `n` values (sd 0 for a single value). */
export interface Stat {
  readonly mean: number
  readonly sd: number
  readonly n: number
}

/**
 * One case × variant, over its trials. Criteria, score, cost and duration are averaged over graded trials (`passed`,
 * `failed`): an infra error or a skip would drag them towards 0.
 *
 * Criteria are a share per trial, met over the criteria that trial was graded on: a criterion a closed gate left out
 * (`judge().when(...)`) is neither met nor missed, so a perfect `non` (3 criteria) and a perfect `oui` (4) both count 1.
 */
export interface GroupAggregate {
  readonly caseId: string
  readonly variant: string
  readonly trials: number
  readonly passed: number
  readonly failed: number
  readonly other: number
  readonly skipped: number
  /** Share of its criteria a graded trial met, in `[0, 1]`, over the graded trials that have criteria. */
  readonly criteria?: Stat
  /** Share of its decoys a graded trial met, in `[0, 1]`, over the graded trials that have decoys. */
  readonly decoys?: Stat
  /** Graded trials with a principal criterion, and those where every principal one was met; absent without any. */
  readonly principal?: { readonly met: number; readonly of: number }
  /** Normalized score in `[0, 1]`, over the graded trials that have one (`n`): a closed gate leaves a trial without. */
  readonly score?: Stat
  /** Cost of the agent under test, judge excluded. */
  readonly costUsd?: Stat
  readonly durationMs?: Stat
  readonly judgeCalls: number
  readonly judgeCostUsd: number
}

/** A variant against the baseline, on one case: difference of the means (variant − baseline). */
export interface Ablation {
  readonly caseId: string
  readonly variant: string
  readonly baseline: string
  /** Difference of the shares of criteria met, in `[-1, 1]`. */
  readonly criteria?: number
  readonly score?: number
  readonly costUsd?: number
  /** Difference of the pass rates, in `[-1, 1]`; absent when a side has no graded trial (all `other`, say). */
  readonly passRate?: number
}

export interface Aggregates {
  readonly baseline: string
  readonly groups: readonly GroupAggregate[]
  /** Every judge call of the run, retries included, and what they cost. */
  readonly judge: { readonly calls: number; readonly costUsd: number }
}

/** What `results.extra` holds: aggregates and ablation, derived from the tests only. */
export interface RunAggregates {
  readonly aggregates: Aggregates
  readonly ablation: readonly Ablation[]
}

/**
 * Mean and sample standard deviation.
 *
 * @example
 * stat([8, 10, 11]) // { mean: 9.67, sd: 1.53, n: 3 } (unrounded)
 */
export function stat(values: readonly number[]): Stat | undefined {
  if (values.length === 0) return undefined
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.length < 2 ? 0 : values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)
  return { mean, sd: Math.sqrt(variance), n: values.length }
}

/**
 * Case and variant of a test, from the `[suite, case, variant]` hierarchy `toCtrf` writes.
 *
 * @example
 * groupOf(test) // { caseId: "greets-world", variant: "baseline" }
 */
export const groupOf = (test: CtrfTest): { caseId: string; variant: string } => ({
  caseId: test.suite?.[1] ?? test.name,
  variant: test.suite?.[2] ?? "",
})

/** @example extraOf(test).criteria // [{ id: "c01", met: true, ... }] */
export const extraOf = (test: CtrfTest): CtrfTrialExtra => test.extra ?? {}
const count = (tests: readonly CtrfTest[], status: CtrfStatus) => tests.filter((t) => t.status === status).length
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)
const defined = <T>(values: readonly (T | undefined)[]) => values.filter((v): v is T => v !== undefined)
/** Met over graded: the denominator is what this trial was graded on; `undefined` when it was graded on nothing. */
const share = (criteria: readonly { readonly met: boolean }[]) =>
  criteria.length === 0 ? undefined : criteria.filter((c) => c.met).length / criteria.length

function group(caseId: string, variant: string, tests: readonly CtrfTest[]): GroupAggregate {
  const graded = tests.filter((t) => t.status === "passed" || t.status === "failed")
  const criteria = graded.map((t) => extraOf(t).criteria ?? [])
  const met = stat(defined(criteria.map(share)))
  const decoysMet = stat(defined(criteria.map((cs) => share(cs.filter((c) => c.decoy)))))
  const score = stat(defined(graded.map((t) => extraOf(t).score)))
  const cost = stat(defined(graded.map((t) => extraOf(t).costUsd)))
  const withPrincipal = criteria.filter((cs) => cs.some((c) => c.principal))
  const duration = stat(graded.map((t) => t.duration))
  return {
    caseId,
    variant,
    trials: tests.length,
    passed: count(tests, "passed"),
    failed: count(tests, "failed"),
    other: count(tests, "other"),
    skipped: count(tests, "skipped"),
    ...(met && { criteria: met }),
    ...(decoysMet && { decoys: decoysMet }),
    ...(withPrincipal.length > 0 && {
      principal: { met: withPrincipal.filter((cs) => cs.every((c) => c.met || !c.principal)).length, of: withPrincipal.length },
    }),
    ...(score && { score }),
    ...(cost && { costUsd: cost }),
    ...(duration && { durationMs: duration }),
    judgeCalls: sum(tests.map((t) => extraOf(t).judgeCalls ?? 0)),
    judgeCostUsd: sum(tests.map((t) => extraOf(t).judgeCostUsd ?? 0)),
  }
}

const delta = (variant?: Stat, baseline?: Stat) => (variant && baseline ? variant.mean - baseline.mean : undefined)

function ablate(variant: GroupAggregate, baseline: GroupAggregate): Ablation {
  const rate = (g: GroupAggregate) => (g.passed + g.failed === 0 ? undefined : g.passed / (g.passed + g.failed))
  const [variantRate, baselineRate] = [rate(variant), rate(baseline)]
  const criteria = delta(variant.criteria, baseline.criteria)
  const score = delta(variant.score, baseline.score)
  const cost = delta(variant.costUsd, baseline.costUsd)
  return {
    caseId: variant.caseId,
    variant: variant.variant,
    baseline: baseline.variant,
    ...(criteria !== undefined && { criteria }),
    ...(score !== undefined && { score }),
    ...(cost !== undefined && { costUsd: cost }),
    ...(variantRate !== undefined && baselineRate !== undefined && { passRate: variantRate - baselineRate }),
  }
}

/**
 * Aggregates the tests of a CTRF document per case × variant, in their order, then compares each variant with
 * `baseline` on the same case. Reads only the tests, so it also works on an archived report.
 *
 * @example
 * const { aggregates, ablation } = aggregate(report.results.tests, "baseline")
 * ablation[0] // { caseId: "x", variant: "with-sdlc", baseline: "baseline", criteria: 0.25, costUsd: 0.92, passRate: 0 }
 */
export function aggregate(tests: readonly CtrfTest[], baseline = DEFAULT_BASELINE): RunAggregates {
  const keyed = new Map<string, { caseId: string; variant: string; tests: CtrfTest[] }>()
  for (const test of tests) {
    const { caseId, variant } = groupOf(test)
    const key = JSON.stringify([caseId, variant])
    const entry = keyed.get(key) ?? { caseId, variant, tests: [] }
    entry.tests.push(test)
    keyed.set(key, entry)
  }
  const groups = [...keyed.values()].map((g) => group(g.caseId, g.variant, g.tests))
  const ablation = groups.flatMap((g) => {
    const base = groups.find((b) => b.caseId === g.caseId && b.variant === baseline)
    return base && g !== base ? [ablate(g, base)] : []
  })
  const judge = { calls: sum(groups.map((g) => g.judgeCalls)), costUsd: sum(groups.map((g) => g.judgeCostUsd)) }
  return { aggregates: { baseline, groups, judge }, ablation }
}

/**
 * The aggregates of a report, recomputed from its tests: against `baseline` when given (`report --baseline`), else
 * against the baseline the run used. Recomputing also covers a report written before aggregates existed, and never
 * trusts numbers a hand-edited `results.extra` would carry.
 *
 * @example
 * aggregatesOf(await readCtrf("run.ctrf.json"), "with-sdlc")
 */
export function aggregatesOf(report: CtrfReport, baseline?: string): RunAggregates {
  const stored = (report.results.extra as Partial<RunAggregates> | undefined)?.aggregates?.baseline
  return aggregate(report.results.tests, baseline ?? (typeof stored === "string" ? stored : DEFAULT_BASELINE))
}
