/**
 * CTRF types, written by hand from the official JSON schema (draft-07), limited to what the harness writes.
 * @see https://github.com/ctrf-io/ctrf/blob/main/schema/ctrf.schema.json
 */

export type CtrfStatus = "passed" | "failed" | "skipped" | "pending" | "other"

export interface CtrfReport {
  readonly reportFormat: "CTRF"
  /** SemVer of the CTRF specification. */
  readonly specVersion: string
  /** UUID of this document. */
  readonly reportId?: string
  /** Logical run id, shared by documents of the same run. */
  readonly runId?: string
  /** RFC 3339 date-time. */
  readonly timestamp?: string
  readonly generatedBy?: string
  readonly results: CtrfResults
  readonly extra?: Record<string, unknown>
}

export interface CtrfResults {
  readonly tool: { readonly name: string; readonly version?: string }
  readonly summary: CtrfSummary
  readonly tests: readonly CtrfTest[]
  readonly environment?: CtrfEnvironment
  readonly extra?: Record<string, unknown>
}

export interface CtrfSummary {
  readonly tests: number
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly pending: number
  readonly other: number
  readonly suites?: number
  /** Epoch milliseconds. */
  readonly start: number
  /** Epoch milliseconds. */
  readonly stop: number
  /** Milliseconds. */
  readonly duration?: number
}

export interface CtrfTest {
  readonly name: string
  readonly status: CtrfStatus
  /** Milliseconds (integer). */
  readonly duration: number
  /** Stable id of the logical test. */
  readonly testId?: string
  /** Unique id of this execution within the run. */
  readonly executionId?: string
  /** Epoch milliseconds. */
  readonly start?: number
  /** Epoch milliseconds. */
  readonly stop?: number
  /** Hierarchy from top-level to immediate parent; at least one item. */
  readonly suite?: readonly string[]
  readonly message?: string
  readonly trace?: string
  readonly labels?: Readonly<Record<string, string | number | boolean>>
  readonly extra?: Record<string, unknown>
}

export interface CtrfEnvironment {
  readonly reportName?: string
  readonly commit?: string
  readonly branchName?: string
  readonly osPlatform?: string
  readonly osRelease?: string
  readonly extra?: Record<string, unknown>
}

/** What `toCtrf` writes in `tests[].extra`, as the reports read it back. */
export interface CtrfTrialExtra {
  readonly criteria?: readonly {
    readonly id: string
    readonly met: boolean
    readonly why?: string
    readonly text?: string
    readonly principal?: boolean
    readonly decoy?: boolean
    readonly grader?: string
  }[]
  readonly score?: number
  readonly costUsd?: number
  readonly model?: string
  readonly turns?: number
  readonly transcript?: string
  readonly judgeCalls?: number
  readonly judgeCostUsd?: number
  readonly judgeModel?: string
  /** Bytes the judge prompt left out of the diff and of the answer, to stay under its size limit. */
  readonly judgeTruncated?: { readonly diffBytes: number; readonly answerBytes: number }
}
