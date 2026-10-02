import type { RunInfo, RunResult, TrialResult } from "./run.ts"

/**
 * Observes a run. Every callback is optional; reporters must not throw on partial data.
 * An error thrown by `onTrialEnd` is recorded in `suiteErrors` and the run goes on;
 * one thrown by `onRunStart` or `onRunEnd` aborts the command.
 */
export interface Reporter {
  onRunStart?(run: RunInfo): Promise<void> | void
  /** Called in completion order, which differs from matrix order when trials run in parallel. */
  onTrialEnd?(trial: TrialResult): Promise<void> | void
  /** Receives trials in matrix order. */
  onRunEnd?(run: RunResult): Promise<void> | void
}
