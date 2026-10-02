import pLimit from "p-limit"
import { z } from "zod"
import type { AgentAdapter } from "../ports/agent.ts"
import type { JudgeRuntime } from "../ports/grader.ts"
import type { Reporter } from "../ports/reporter.ts"
import type { AgentInfo, HostEnvironment, RunEnvironment, SandboxInfo, RunInfo, RunResult, TrialResult } from "../ports/run.ts"
import type { Sandbox } from "../ports/sandbox.ts"
import { asError, step } from "./errors.ts"
import { timestampedId } from "../shared/ids.ts"
import { abortedTrial, runTrial, type TrialRuntime } from "./lifecycle.ts"
import { buildMatrix } from "./matrix.ts"
import type { SuiteDefinition, SuiteHook } from "./model.ts"

const runOptionsSchema = z.object({
  repeat: z.number().int().min(1).default(1),
  concurrency: z.number().int().min(1).default(1),
  cases: z.array(z.string()).optional(),
  variants: z.array(z.string()).optional(),
  runId: z.string().min(1).optional(),
})

export interface RunOptions {
  readonly agent: AgentAdapter
  readonly sandbox: Sandbox
  /** The agent graders ask for a verdict, in its own sandbox: never the agent under test. None: a judge grader throws. */
  readonly judge?: JudgeRuntime
  readonly reporters?: readonly Reporter[]
  /** Trials per case × variant (`--repeat`). Default 1. */
  readonly repeat?: number
  /** Maximum trials running at once (`-j`). Default 1. */
  readonly concurrency?: number
  /** Only run these case ids. */
  readonly cases?: readonly string[]
  /** Only run these variant names. */
  readonly variants?: readonly string[]
  /** Defaults to a timestamp-based id. */
  readonly runId?: string
  /** Host facts written in the report (commit, branch, OS). */
  readonly host?: HostEnvironment
  /** Epoch milliseconds; injectable for tests. */
  readonly now?: () => number
  /**
   * Interrupts the run (Ctrl-C): running trials stop and clean up, the others are not started, all are `other`;
   * `afterAll` and reporters still run, so the partial report is written.
   */
  readonly signal?: AbortSignal
}

/**
 * Runs every trial of the matrix, `concurrency` at a time, between `beforeAll` and `afterAll`.
 * Trials are returned in matrix order whatever their completion order.
 * A failing `beforeAll` makes every trial `other`; a failing `afterAll` or `onTrialEnd` lands in `suiteErrors`.
 *
 * @example
 * const run = await runSuite(definition, { agent, sandbox, repeat: 3, concurrency: 2 })
 * process.exitCode = exitCodeFor(run)
 */
export async function runSuite(suite: SuiteDefinition, options: RunOptions): Promise<RunResult> {
  const parsed = runOptionsSchema.safeParse(options)
  if (!parsed.success) throw new Error(`Invalid run options:\n${z.prettifyError(parsed.error)}`)
  const { repeat, concurrency, cases, variants, runId = newRunId() } = parsed.data
  const { agent, sandbox, judge, reporters = [], host = {}, now = Date.now } = options
  const plans = buildMatrix(suite, { repeat, cases, variants })
  const signal = options.signal ?? new AbortController().signal
  const runtime: TrialRuntime = { agent, sandbox, now, signal, ...(judge && { judge }) }
  // The report names a judge only when a trial of the run may ask it.
  const judged = plans.some((plan) => plan.testCase.graders.some((g) => g.usesJudge))

  const [agentVersion, judgeVersion] = await Promise.all([agentInfo(agent), judge && judged ? judgeInfo(judge) : undefined])
  const info: RunInfo = {
    runId,
    suite: suite.name,
    start: now(),
    plannedTrials: plans.length,
    environment: {
      agent: agentVersion,
      sandbox: sandboxInfo(sandbox),
      ...(judgeVersion && { judge: judgeVersion }),
      host,
    },
  }
  for (const reporter of reporters) await reporter.onRunStart?.(info)

  // A reporter error must not reject the batch: afterAll would then run while trials are still in flight.
  const reporterErrors: string[] = []
  const report = async (trial: TrialResult) => {
    for (const reporter of reporters) {
      await step("reporter onTrialEnd", () => reporter.onTrialEnd?.(trial)).catch((error: unknown) => {
        reporterErrors.push(asError(error).message)
      })
    }
    return trial
  }

  const beforeAllError = await runHooks("beforeAll", suite.beforeAll)
  let trials: TrialResult[]
  let afterAllError: Error | undefined
  try {
    if (beforeAllError) {
      trials = await Promise.all(plans.map((plan) => report(abortedTrial(plan, beforeAllError, now()))))
    } else {
      const limit = pLimit(concurrency)
      trials = await Promise.all(plans.map((plan) => limit(async () => report(await runTrial(plan, runtime)))))
    }
  } finally {
    afterAllError = await runHooks("afterAll", suite.afterAll)
  }

  const suiteErrors = [...reporterErrors, ...(afterAllError ? [afterAllError.message] : [])]
  const run: RunResult = { ...info, stop: now(), trials, suiteErrors }
  for (const reporter of reporters) await reporter.onRunEnd?.(run)
  return run
}

/** Runs hooks in order, stopping at the first failure, which is returned rather than thrown. */
async function runHooks(label: string, hooks: readonly SuiteHook[]): Promise<Error | undefined> {
  try {
    await step(label, async () => {
      for (const hook of hooks) await hook()
    })
    return undefined
  } catch (error) {
    return asError(error)
  }
}

async function agentInfo(agent: AgentAdapter): Promise<AgentInfo> {
  return { id: agent.id, version: await agent.version(), ...(agent.details && { details: agent.details }) }
}

async function judgeInfo(judge: JudgeRuntime): Promise<NonNullable<RunEnvironment["judge"]>> {
  return { ...(await agentInfo(judge.agent)), sandbox: sandboxInfo(judge.sandbox), ...(judge.model && { model: judge.model }) }
}

const sandboxInfo = (sandbox: Sandbox): SandboxInfo => ({ id: sandbox.id, isolation: sandbox.isolation })

function newRunId(): string {
  return timestampedId(2)
}
