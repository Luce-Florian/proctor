import type { GroupAggregate, Stat } from "./aggregates.ts"

/** What every report shows for an absent value. */
export const NONE = "—"

// Number formats shared by the console, markdown and HTML reports, so a run reads the same in each of them.

/** @example meanSd({ mean: 9.667, sd: 1.528, n: 3 }) // "9.7 ± 1.5" */
export function meanSd(stat: Stat | undefined, digits = 1): string {
  return stat ? `${stat.mean.toFixed(digits)} ± ${stat.sd.toFixed(digits)}` : NONE
}

/** @example signed(0.8, 2) // "+0.80" */
export function signed(value: number | undefined, digits: number): string {
  if (value === undefined) return NONE
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`
}

/** A share in `[0, 1]` as a percentage, mean ± sd. @example percent({ mean: 0.875, sd: 0.177, n: 2 }) // "88% ± 18" */
export function percent(stat: Stat | undefined): string {
  return stat ? `${(stat.mean * 100).toFixed(0)}% ± ${(stat.sd * 100).toFixed(0)}` : NONE
}

/** A difference of shares, in percentage points. @example points(-0.25) // "-25 pts" */
export function points(value: number | undefined): string {
  return value === undefined ? NONE : `${signed(value * 100, 0)} pts`
}

/** The score of a group, with over how many graded trials it is averaged when some have none. @example score(group) // "0.50 ± 0.00 (1/2)" */
export function score(group: GroupAggregate): string {
  if (!group.score) return NONE
  const graded = group.passed + group.failed
  return `${meanSd(group.score, 2)}${group.score.n < graded ? ` (${group.score.n}/${graded})` : ""}`
}

/** Cents are too coarse under a dollar, where most trials cost: 3 decimals there, 2 above. */
const usdDigits = (value: number) => (Math.abs(value) < 1 ? 3 : 2)

/**
 * @example
 * usd(0.0421) // "$0.042"
 * usd(3.5) // "$3.50"
 */
export function usd(value: number | undefined): string {
  return value === undefined ? NONE : `$${value.toFixed(usdDigits(value))}`
}

/** @example usdMeanSd({ mean: 0.042, sd: 0.011, n: 3 }) // "$0.042 ± 0.011" */
export function usdMeanSd(stat: Stat | undefined): string {
  return stat ? `${usd(stat.mean)} ± ${stat.sd.toFixed(usdDigits(stat.mean))}` : NONE
}

/** A cost difference. @example signedUsd(-0.0125) // "-$0.013" */
export function signedUsd(value: number | undefined): string {
  if (value === undefined) return NONE
  return `${value > 0 ? "+" : ""}${value < 0 ? "-" : ""}${usd(Math.abs(value))}`
}

/**
 * @example
 * duration(12_340) // "12.3s"
 * duration(90_000) // "1.5 min"
 */
export function duration(ms: number | undefined): string {
  if (ms === undefined) return NONE
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)} min`
}

/** What a report derived from a CTRF document may change at render time. */
export interface RenderOptions {
  /** Variant the ablation compares the others with; default: the one the run used. */
  readonly baseline?: string
}
