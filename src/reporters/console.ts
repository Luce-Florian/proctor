import { countByStatus, trialLabel } from "../core/trial-summary.ts"
import type { Reporter } from "../ports/reporter.ts"
import { TRIAL_STATUSES, type RunInfo, type RunResult, type TrialResult, type TrialStatus } from "../ports/run.ts"

const TAG: Record<TrialStatus, string> = { passed: "PASS ", failed: "FAIL ", other: "OTHER", skipped: "SKIP " }

/** Minimal writable stream, e.g. `process.stdout`. */
export interface Output {
  write(chunk: string): unknown
}

/**
 * Prints one line per trial as it ends, then a one-line summary.
 *
 * @example
 * reporters: [new ConsoleReporter(process.stdout)]
 */
export class ConsoleReporter implements Reporter {
  readonly #out: Output

  constructor(out: Output) {
    this.#out = out
  }

  /** @example "Running hello: 3 trials (agent fake 0.0.0, sandbox fake, isolation none)" */
  onRunStart(run: RunInfo): void {
    const { agent, sandbox } = run.environment
    const env = `agent ${agent.id} ${agent.version}, sandbox ${sandbox.id}, isolation ${sandbox.isolation}`
    this.#out.write(`Running ${run.suite}: ${run.plannedTrials} trials (${env})\n`)
  }

  /** @example "PASS  greets-world [baseline] #1 (12ms)" */
  onTrialEnd(trial: TrialResult): void {
    const message = trial.message ? ` — ${trial.message}` : ""
    this.#out.write(`${TAG[trial.status]} ${trialLabel(trial)} (${trial.stop - trial.start}ms)${message}\n`)
  }

  /** @example "3 trials: 2 passed, 1 failed, 0 other, 0 skipped" */
  onRunEnd(run: RunResult): void {
    const counts = countByStatus(run.trials)
    const errors = run.suiteErrors.map((e) => `\nSuite error: ${e}`).join("")
    this.#out.write(`${run.trials.length} trials: ${TRIAL_STATUSES.map((s) => `${counts[s]} ${s}`).join(", ")}${errors}\n`)
  }
}
