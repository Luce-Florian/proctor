import type { RunResult } from "../ports/run.ts"

/** Process exit codes, CI-friendly: 0 ok, 1 evaluation failed, 2 infrastructure error. */
export const ExitCode = {
  /** Every trial passed or was skipped. */
  Ok: 0,
  /** At least one evaluation failed. */
  EvalFailed: 1,
  /** At least one infrastructure error (trial `other` or suite error); wins over evaluation failures. */
  InfraError: 2,
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

/**
 * Derives the process exit code from a run.
 *
 * @example
 * process.exitCode = exitCodeFor(run)
 */
export function exitCodeFor(run: {
  readonly trials: readonly Pick<RunResult["trials"][number], "status">[]
  readonly suiteErrors?: readonly string[]
}): ExitCode {
  if ((run.suiteErrors?.length ?? 0) > 0 || run.trials.some((t) => t.status === "other")) return ExitCode.InfraError
  if (run.trials.some((t) => t.status === "failed")) return ExitCode.EvalFailed
  return ExitCode.Ok
}
