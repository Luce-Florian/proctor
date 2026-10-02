import { sumTokens, type AgentAdapter, type AgentRunResult, type TokenUsage } from "./agent.ts"
import type { Sandbox } from "./sandbox.ts"
import type { Workspace } from "./workspace.ts"

/** Verdict on one criterion, identified by a stable id. */
export interface CriterionVerdict {
  readonly id: string
  readonly met: boolean
  /** Short justification, shown in reports. */
  readonly why?: string
  /** The criterion as its author stated it, shown in reports next to the id. */
  readonly text?: string
  /** A missed principal criterion fails the trial whatever the score. */
  readonly principal?: boolean
  /** A decoy is met when the agent did NOT fall into the trap. */
  readonly decoy?: boolean
}

/** What asking an agent for a verdict cost, summed over its attempts (retries included). */
export interface JudgeUsage {
  /** Agent runs, retries included. */
  readonly calls: number
  readonly costUsd?: number
  readonly tokens?: TokenUsage
  /** Exact model that answered, as the judge agent resolved it. */
  readonly model?: string
  /** Transcripts of the judge runs, when its adapter keeps them. */
  readonly transcripts?: readonly string[]
  /** Bytes left out of the prompt to keep it under its size limit, per block; absent when nothing was cut. */
  readonly truncated?: { readonly diffBytes: number; readonly answerBytes: number }
}

/**
 * Sums judge usages: calls, cost and tokens; a cost or token count stays unknown when no usage reported one.
 * `undefined` when there is none.
 *
 * @example
 * mergeJudgeUsage(trial.grades.flatMap((g) => g.judgeUsage ?? [])) // { calls: 3, costUsd: 0.21, ... }
 */
export function mergeJudgeUsage(usages: readonly JudgeUsage[]): JudgeUsage | undefined {
  if (usages.length === 0) return undefined
  const costs = usages.flatMap((u) => (u.costUsd === undefined ? [] : [u.costUsd]))
  const tokens = usages.flatMap((u) => u.tokens ?? [])
  const transcripts = usages.flatMap((u) => u.transcripts ?? [])
  const model = usages.findLast((u) => u.model)?.model
  const truncated = usages.findLast((u) => u.truncated)?.truncated
  return {
    calls: usages.reduce((total, u) => total + u.calls, 0),
    ...(costs.length > 0 && { costUsd: costs.reduce((a, b) => a + b, 0) }),
    ...(tokens.length > 0 && { tokens: sumTokens(tokens) }),
    ...(model && { model }),
    ...(transcripts.length > 0 && { transcripts }),
    ...(truncated && { truncated }),
  }
}

/** Outcome of one grader for one trial. */
export interface GradeResult {
  readonly graderId: string
  readonly passed: boolean
  /** Optional normalized score in `[0, 1]`. */
  readonly score?: number
  readonly criteria: readonly CriterionVerdict[]
  /** Set by graders that ask an agent for a verdict: never counted in the cost of the agent under test. */
  readonly judgeUsage?: JudgeUsage
}

/**
 * The agent that judges, and the sandbox it runs in: both independent of the agent under test,
 * so scores stay comparable whatever `--agent` evaluates.
 */
export interface JudgeRuntime {
  readonly agent: AgentAdapter
  readonly sandbox: Sandbox
  /** Default model of the judge; a grader that pins its own wins. */
  readonly model?: string
}

/** What a grader can look at. */
export interface GradeContext {
  readonly caseId: string
  readonly variant: string
  /** 1-based repetition index. */
  readonly trial: number
  readonly result: AgentRunResult
  readonly workspace: Workspace
  /** The judge of the run, for graders that ask an agent for a verdict; absent when the run has none. */
  readonly judge?: JudgeRuntime
  /** Aborted when the run is interrupted: a grader that runs an agent passes it on. */
  readonly signal: AbortSignal
}

/**
 * A condition on the run of the agent under test, e.g. `verdictIs("yes")`: what a grader that only applies to some
 * runs is gated on.
 */
export type AgentResultPredicate = (result: AgentRunResult) => boolean

/**
 * Turns an agent run into a verdict. Throwing means an infrastructure error (trial status `other`),
 * not a failed evaluation: return `passed: false` for that.
 *
 * The trial fails when `passed` is false or when a criterion flagged `principal` is not met:
 * the core enforces the second rule, whatever `passed` says.
 */
export interface Grader {
  readonly id: string
  /**
   * Called once the workspace is ready (fixtures, agent prepare, `beforeEach`), right before the agent runs:
   * records what `grade` compares against, e.g. a snapshot of the files. A grader shared by concurrent trials
   * keys that state by workspace.
   */
  prepare?(workspace: Workspace): Promise<void>
  grade(context: GradeContext): Promise<GradeResult>
  /**
   * Set by a grader that asks the run's judge for a verdict, with the model it pins, if any. A run without such a
   * grader never instantiates a judge.
   */
  readonly usesJudge?: { readonly model?: string }
}

/**
 * Thrown by a grader that could not reach a verdict (e.g. a judge that never answered valid JSON): the trial is
 * `other`, and `trace` (the raw answers) becomes the trial trace instead of a stack.
 *
 * @example
 * throw new GradeError("the judge answered invalid JSON 3 times", attempts.join("\n---\n"))
 */
export class GradeError extends Error {
  override readonly name = "GradeError"

  constructor(
    message: string,
    readonly trace: string,
    /** What the judge calls made before the failure cost: the trial reports it even without a verdict. */
    readonly judgeUsage?: JudgeUsage,
  ) {
    super(message)
  }
}
