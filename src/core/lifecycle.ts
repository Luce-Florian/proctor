import type { AgentAdapter, AgentPrepareInput, AgentRunInput, AgentRunResult } from "../ports/agent.ts"
import type { GradeContext, GradeResult, JudgeRuntime } from "../ports/grader.ts"
import type { TrialResult, TrialStatus } from "../ports/run.ts"
import { mergeAccess, type Sandbox, type SandboxAccess } from "../ports/sandbox.ts"
import { asError, judgeUsageOf, step, traceOf, transcriptPathOf } from "./errors.ts"
import type { CaseDefinition, TrialContext, VariantDefinition } from "./model.ts"
import { withTimeout } from "./timeout.ts"
import { trialLabel } from "./trial-summary.ts"

/** One cell of the matrix: a case, a variant and a repetition index. */
export interface TrialPlan {
  readonly suite: string
  /** What the suite needs through the sandbox, merged with what the agent needs. */
  readonly sandboxAccess: SandboxAccess
  readonly testCase: CaseDefinition
  readonly variant: VariantDefinition
  /** 1-based repetition index. */
  readonly trial: number
}

/** What a trial needs to run. */
export interface TrialRuntime {
  readonly agent: AgentAdapter
  readonly sandbox: Sandbox
  /** Handed to graders that ask an agent for a verdict. */
  readonly judge?: JudgeRuntime
  /** Epoch milliseconds; injectable for tests. */
  readonly now: () => number
  /** Aborted when the run is interrupted: the agent, prepare and graders stop, cleanups still run. */
  readonly signal: AbortSignal
}

type Cleanup = readonly [label: string, task: () => unknown]

/**
 * Runs one trial through its whole lifecycle:
 * `sandbox.create` › fixtures setup › agent prepare › `beforeEach` › graders prepare › act › assert › `afterEach` › prepare undo ›
 * fixtures teardown (LIFO) › `sandbox.destroy`.
 *
 * Every step that succeeds pushes its undo on a stack, unwound whatever failed afterwards.
 * `afterEach` is stacked once fixtures are set up and the agent prepared, so it runs even when `beforeEach` throws.
 * Any error, timeout or interruption makes the trial `other`; only graders can make it `failed`.
 * A trial whose run is already interrupted does not start.
 *
 * @example
 * const trial = await runTrial(plan, { agent, sandbox, now: Date.now, signal: interrupt.signal })
 */
export async function runTrial(plan: TrialPlan, runtime: TrialRuntime): Promise<TrialResult> {
  const start = runtime.now()
  const { testCase, variant } = plan
  const ids = { caseId: testCase.id, variant: variant.name, trial: plan.trial }
  if (testCase.skipReason !== undefined) {
    return result(plan, { status: "skipped", message: testCase.skipReason, start, stop: runtime.now(), grades: [] })
  }
  if (runtime.signal.aborted) return abortedTrial(plan, asError(runtime.signal.reason), start)

  const errors: Error[] = []
  const cleanups: Cleanup[] = []
  const grades: GradeResult[] = []
  let agentResult: AgentRunResult | undefined
  let failedTranscript: string | undefined
  const { signal } = runtime

  try {
    const access = mergeAccess(runtime.agent.sandboxAccess, plan.sandboxAccess)
    const workspace = await step("sandbox create", () => runtime.sandbox.create({ label: trialLabel(ids), access }))
    cleanups.push(["sandbox destroy", () => runtime.sandbox.destroy(workspace)])
    for (const fixture of testCase.fixtures) {
      const teardown = await step(`fixture ${fixture.description} setup`, () => fixture.setup(workspace))
      if (teardown) cleanups.push([`fixture ${fixture.description} teardown`, teardown])
    }
    const undo = await step("agent prepare", () => runtime.agent.prepare?.(agentSetup(variant, signal), workspace))
    if (undo) cleanups.push(["agent prepare undo", undo])
    const context: TrialContext = { ...ids, workspace }
    // Pushed in reverse so that, once the stack unwinds, afterEach hooks run in declaration order.
    for (const hook of [...variant.afterEach].reverse()) cleanups.push(["afterEach", () => hook(context)])
    for (const hook of variant.beforeEach) await step("beforeEach", () => hook(context))
    for (const grader of testCase.graders) {
      if (grader.prepare) await step(`grader ${grader.id} prepare`, () => grader.prepare?.(workspace))
    }
    const act = (trialSignal: AbortSignal) =>
      runtime.agent.run(agentInput(plan, trialSignal), workspace).catch((error: unknown) => {
        failedTranscript = transcriptPathOf(error)
        throw error
      })
    const run = await step("agent run", () => withTimeout(act, testCase.timeoutMs, { signal }))
    agentResult = withoutRaw(run)
    const gradeContext: GradeContext = { ...ids, result: run, workspace, signal, ...(runtime.judge && { judge: runtime.judge }) }
    for (const grader of testCase.graders) {
      const grade = await step(`grader ${grader.id}`, () => grader.grade(gradeContext)).catch((error: unknown) => {
        // No verdict, but the judge calls made before the failure were paid for: the report counts them.
        const judgeUsage = judgeUsageOf(error)
        if (judgeUsage) grades.push({ graderId: grader.id, passed: false, criteria: [], judgeUsage })
        throw error
      })
      grades.push(grade)
    }
  } catch (error) {
    errors.push(asError(error))
  }

  for (const [label, task] of cleanups.reverse()) {
    await step(label, task).catch((error: unknown) => errors.push(asError(error)))
  }

  const outcome = errors.length > 0 ? errorOutcome(errors) : gradeOutcome(grades)
  const transcriptPath = agentResult?.transcriptPath ?? failedTranscript
  return result(plan, {
    ...outcome,
    start,
    stop: runtime.now(),
    grades,
    ...(agentResult && { agentResult }),
    ...(transcriptPath && { transcriptPath }),
  })
}

/**
 * A trial that could not start, e.g. because `beforeAll` failed. A skipped case stays `skipped`.
 *
 * @example
 * abortedTrial(plan, new Error("beforeAll failed: ..."), Date.now()).status // "other"
 */
export function abortedTrial(plan: TrialPlan, error: Error, at: number): TrialResult {
  const { skipReason } = plan.testCase
  const outcome: Outcome = skipReason !== undefined ? { status: "skipped", message: skipReason } : errorOutcome([error])
  return result(plan, { ...outcome, start: at, stop: at, grades: [] })
}

function agentSetup(variant: VariantDefinition, signal: AbortSignal): AgentPrepareInput {
  return {
    signal,
    plugins: variant.plugins,
    mcpServers: variant.mcpServers,
    ...(variant.model !== undefined && { model: variant.model }),
    permissions: variant.permissions,
    settings: variant.settings,
  }
}

function agentInput(plan: TrialPlan, signal: AbortSignal): AgentRunInput {
  const { variant, testCase } = plan
  return { ...agentSetup(variant, signal), prompt: variant.prompt({ id: testCase.id, context: testCase.context }) }
}

/** Graders already saw `raw`; trials are kept until the run ends, so the adapter payload is dropped. */
function withoutRaw({ raw, ...rest }: AgentRunResult): AgentRunResult {
  return rest
}

interface Outcome {
  status: TrialStatus
  message?: string
  trace?: string
}

function errorOutcome(errors: readonly Error[]): Outcome {
  const trace = traceOf(errors[0]) ?? errors[0]?.stack
  return { status: "other", message: errors.map((e) => e.message).join("; "), ...(trace && { trace }) }
}

/** A missed principal criterion fails the grade, whatever the grader said. */
const passes = (grade: GradeResult) => grade.passed && grade.criteria.every((c) => c.met || !c.principal)

/** Said of a trial whose graders all passed without a criterion: a pass that checked nothing is no pass. */
const NOTHING_GRADED =
  "Nothing was graded: every grader left its criteria out (a closed .when() gate?); keep one outside the gate, e.g. verdictEquals"

function gradeOutcome(grades: readonly GradeResult[]): Outcome {
  const failing = grades.filter((g) => !passes(g))
  if (failing.length === 0)
    return grades.some((g) => g.criteria.length > 0) ? { status: "passed" } : { status: "other", message: NOTHING_GRADED }
  const unmet = failing.flatMap((g) => g.criteria.filter((c) => !c.met).map((c) => (c.principal ? `${c.id} (principal)` : c.id)))
  const message =
    unmet.length > 0 ? `Unmet criteria: ${unmet.join(", ")}` : `Graders did not pass: ${failing.map((g) => g.graderId).join(", ")}`
  return { status: "failed", message }
}

function result(
  plan: TrialPlan,
  fields: Outcome & Pick<TrialResult, "start" | "stop" | "grades"> & { agentResult?: AgentRunResult; transcriptPath?: string },
): TrialResult {
  return { suite: plan.suite, caseId: plan.testCase.id, variant: plan.variant.name, trial: plan.trial, ...fields }
}
