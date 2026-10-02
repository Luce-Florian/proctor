import type { AgentRunResult } from "./agent.ts"
import type { GradeResult } from "./grader.ts"
import type { IsolationLevel } from "./sandbox.ts"

/**
 * CTRF statuses used by the harness.
 * - `passed`: every grader passed.
 * - `failed`: a grader returned `passed: false`, or reported a principal criterion not met.
 * - `other`: infrastructure error or timeout, never mistaken for an evaluation failure.
 * - `skipped`: not run.
 */
export const TRIAL_STATUSES = ["passed", "failed", "other", "skipped"] as const
export type TrialStatus = (typeof TRIAL_STATUSES)[number]

/** Outcome of one trial (case × variant × repetition). */
export interface TrialResult {
  readonly suite: string
  readonly caseId: string
  readonly variant: string
  /** 1-based repetition index. */
  readonly trial: number
  readonly status: TrialStatus
  readonly message?: string
  readonly trace?: string
  /** Epoch milliseconds. */
  readonly start: number
  /** Epoch milliseconds. */
  readonly stop: number
  readonly grades: readonly GradeResult[]
  readonly agentResult?: AgentRunResult
  /** Raw transcript of the run, kept even when the run failed and there is no `agentResult`. */
  readonly transcriptPath?: string
}

/** Host facts collected by the caller (CLI), written as-is in the report. */
export interface HostEnvironment {
  readonly commit?: string
  readonly branch?: string
  readonly osPlatform?: string
  readonly osRelease?: string
}

/** An agent as the report names it. */
export interface AgentInfo {
  readonly id: string
  readonly version: string
  readonly details?: Readonly<Record<string, string>>
}

export interface SandboxInfo {
  readonly id: string
  readonly isolation: IsolationLevel
}

export interface RunEnvironment {
  readonly agent: AgentInfo
  readonly sandbox: SandboxInfo
  /** The judge of the run, independent of the agent under test; absent when the run has none. */
  readonly judge?: AgentInfo & { readonly sandbox: SandboxInfo; readonly model?: string }
  readonly host: HostEnvironment
}

/** Known at run start. */
export interface RunInfo {
  readonly runId: string
  readonly suite: string
  /** Epoch milliseconds. */
  readonly start: number
  readonly plannedTrials: number
  readonly environment: RunEnvironment
}

/** A finished run; `trials` are in matrix order (case, then variant, then repetition). */
export interface RunResult extends RunInfo {
  /** Epoch milliseconds. */
  readonly stop: number
  readonly trials: readonly TrialResult[]
  /** Suite-level infrastructure errors that no trial carries, e.g. a failing `afterAll` or reporter. */
  readonly suiteErrors: readonly string[]
}
