import type { TrialResult, TrialStatus } from "../ports/run.ts"

/**
 * How a trial is named in logs and reports.
 *
 * @example
 * trialLabel({ caseId: "hello", variant: "baseline", trial: 1 }) // "hello [baseline] #1"
 */
export const trialLabel = (trial: Pick<TrialResult, "caseId" | "variant" | "trial">): string =>
  `${trial.caseId} [${trial.variant}] #${trial.trial}`

/**
 * Counts trials per status, every status present.
 *
 * @example
 * countByStatus(run.trials) // { passed: 2, failed: 0, other: 1, skipped: 0 }
 */
export function countByStatus(trials: readonly Pick<TrialResult, "status">[]): Record<TrialStatus, number> {
  const counts: Record<TrialStatus, number> = { passed: 0, failed: 0, other: 0, skipped: 0 }
  for (const trial of trials) counts[trial.status] += 1
  return counts
}
