import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { countByStatus, trialLabel } from "../core/trial-summary.ts"
import type { Reporter } from "../ports/reporter.ts"
import type { RunResult, TrialResult } from "../ports/run.ts"
import { mergeJudgeUsage } from "../ports/grader.ts"
import { aggregate } from "./aggregates.ts"
import type { CtrfReport, CtrfTest } from "./ctrf-types.ts"
import { writeTextFile } from "./files.ts"

/** CTRF specification version the documents conform to (the official examples use `1.0.0`). */
export const CTRF_SPEC_VERSION = "1.0.0"

export interface CtrfOptions {
  /** Version of proctor, written in `results.tool.version`. */
  readonly toolVersion: string
  /** Variant the ablation compares the others with. Default `baseline`. */
  readonly baseline?: string
}

/**
 * Converts a run to a CTRF document: one trial is one test.
 *
 * @example
 * const report = toCtrf(run, { toolVersion: "0.1.0" })
 */
export function toCtrf(run: RunResult, options: CtrfOptions): CtrfReport {
  const counts = countByStatus(run.trials)
  const { host, agent, sandbox, judge } = run.environment
  const tests = run.trials.map(toTest)
  return {
    reportFormat: "CTRF",
    specVersion: CTRF_SPEC_VERSION,
    reportId: randomUUID(),
    runId: run.runId,
    timestamp: new Date(run.stop).toISOString(),
    generatedBy: "proctor",
    results: {
      tool: { name: "proctor", version: options.toolVersion },
      summary: {
        tests: run.trials.length,
        ...counts,
        pending: 0,
        suites: 1,
        start: run.start,
        stop: run.stop,
        duration: run.stop - run.start,
      },
      tests,
      environment: {
        reportName: run.suite,
        ...(host.commit && { commit: host.commit }),
        ...(host.branch && { branchName: host.branch }),
        ...(host.osPlatform && { osPlatform: host.osPlatform }),
        ...(host.osRelease && { osRelease: host.osRelease }),
        extra: { agent, sandbox: { id: sandbox.id }, isolation: sandbox.isolation, ...(judge && { judge }) },
      },
      extra: { ...aggregate(tests, options.baseline), ...(run.suiteErrors.length > 0 && { suiteErrors: run.suiteErrors }) },
    },
  }
}

function toTest(trial: TrialResult): CtrfTest {
  const testId = `${trial.suite}/${trial.caseId}/${trial.variant}`
  const agent = trial.agentResult
  const scores = trial.grades.flatMap((g) => (g.score === undefined ? [] : [g.score]))
  const judged = mergeJudgeUsage(trial.grades.flatMap((g) => g.judgeUsage ?? []))
  return {
    name: trialLabel(trial),
    status: trial.status,
    duration: trial.stop - trial.start,
    testId,
    executionId: `${testId}#${trial.trial}`,
    start: trial.start,
    stop: trial.stop,
    suite: [trial.suite, trial.caseId, trial.variant],
    ...(trial.message !== undefined && { message: trial.message }),
    ...(trial.trace !== undefined && { trace: trial.trace }),
    labels: { case: trial.caseId, variant: trial.variant, trial: trial.trial },
    // Undefined fields are dropped by JSON.stringify.
    extra: {
      criteria: trial.grades.flatMap((g) => g.criteria.map((c) => ({ ...c, grader: g.graderId }))),
      score: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined,
      costUsd: agent?.costUsd,
      model: agent?.model,
      pluginSha: agent?.pluginSha,
      tokens: agent?.usage,
      turns: agent?.turns,
      agentDurationMs: agent?.durationMs,
      transcript: trial.transcriptPath,
      judgeCalls: judged?.calls,
      judgeCostUsd: judged?.costUsd,
      judgeTokens: judged?.tokens,
      judgeModel: judged?.model,
      judgeTranscripts: judged?.transcripts,
      judgeTruncated: judged?.truncated,
    },
  }
}

/**
 * Where {@link CtrfReporter} writes a run.
 *
 * @example
 * ctrfPath("results", run) // "results/hello/<runId>.ctrf.json"
 */
export function ctrfPath(outDir: string, run: Pick<RunResult, "suite" | "runId">): string {
  return join(outDir, run.suite, `${run.runId}.ctrf.json`)
}

const num = z.number()
const optionalNum = num.optional()
/** The fields the reports print, with their types: a hand-edited file cannot slip markup into a numeric cell. */
const ctrfSchema = z.looseObject({
  reportFormat: z.literal("CTRF"),
  specVersion: z.string(),
  runId: z.string().optional(),
  timestamp: z.string().optional(),
  results: z.looseObject({
    tool: z.looseObject({ name: z.string(), version: z.string().optional() }),
    summary: z.looseObject({ tests: num, passed: num, failed: num, skipped: num, pending: num, other: num, start: num, stop: num }),
    tests: z.array(
      z.looseObject({
        name: z.string(),
        status: z.enum(["passed", "failed", "skipped", "pending", "other"]),
        duration: num,
        suite: z.array(z.string()).optional(),
        message: z.string().optional(),
        labels: z.record(z.string(), z.union([z.string(), num, z.boolean()])).optional(),
        extra: z
          .looseObject({
            criteria: z
              .array(
                z.looseObject({
                  id: z.string(),
                  met: z.boolean(),
                  why: z.string().optional(),
                  text: z.string().optional(),
                  principal: z.boolean().optional(),
                  decoy: z.boolean().optional(),
                }),
              )
              .optional(),
            score: optionalNum,
            costUsd: optionalNum,
            model: z.string().optional(),
            turns: optionalNum,
            judgeCalls: optionalNum,
            judgeCostUsd: optionalNum,
            judgeModel: z.string().optional(),
          })
          .optional(),
      }),
    ),
    environment: z
      .looseObject({ reportName: z.string().optional(), commit: z.string().optional(), branchName: z.string().optional() })
      .optional(),
  }),
})

/**
 * Reads a CTRF file written by `proctor run`, or throws saying it is not one. The fields the reports print are
 * checked against their types, so that a hand-edited file cannot inject markup.
 *
 * @example
 * const report = await readCtrf("results/review/<runId>.ctrf.json")
 */
export async function readCtrf(path: string): Promise<CtrfReport> {
  const report = JSON.parse(await readFile(path, "utf8")) as Partial<CtrfReport>
  if (report.reportFormat !== "CTRF" || !report.results) {
    throw new Error(`"${path}" is not a CTRF report: expected a *.ctrf.json written by proctor run.`)
  }
  const parsed = ctrfSchema.safeParse(report)
  if (!parsed.success) throw new Error(`"${path}" is not a valid CTRF report:\n${z.prettifyError(parsed.error)}`)
  return report as CtrfReport
}

/**
 * A file next to a CTRF file, same run id, another suffix.
 *
 * @example
 * siblingPath("results/hello/run-1.ctrf.json", ".summary.md") // "results/hello/run-1.summary.md"
 */
export const siblingPath = (ctrfFile: string, suffix: string): string => `${ctrfFile.replace(/(\.ctrf)?\.json$/, "")}${suffix}`

/** Derives another file from the CTRF document written at `ctrfFile`, and returns the path it wrote. */
export type CtrfSink = (report: CtrfReport, ctrfFile: string) => Promise<string>

export interface CtrfReporterOptions extends CtrfOptions {
  readonly outDir: string
  /** Files derived from the same document, e.g. `markdownSummary`. */
  readonly sinks?: readonly CtrfSink[]
}

/**
 * Builds the CTRF document once per run, writes it to {@link ctrfPath}, then hands it to each sink.
 *
 * @example
 * new CtrfReporter({ outDir: "results", toolVersion, sinks: [markdownSummary] })
 */
export class CtrfReporter implements Reporter {
  readonly #options: CtrfReporterOptions
  readonly #written: string[] = []

  constructor(options: CtrfReporterOptions) {
    this.#options = options
  }

  /**
   * Files written by the last run, the CTRF first, then one per sink.
   *
   * @example
   * reporter.written // ["results/hello/<runId>.ctrf.json", "results/hello/<runId>.summary.md"]
   */
  get written(): readonly string[] {
    return this.#written
  }

  /** @example await reporter.onRunEnd(run) // writes results/hello/<runId>.ctrf.json */
  async onRunEnd(run: RunResult): Promise<void> {
    const report = toCtrf(run, this.#options)
    const path = await writeTextFile(ctrfPath(this.#options.outDir, run), `${JSON.stringify(report, null, 2)}\n`)
    this.#written.splice(0, this.#written.length, path)
    for (const sink of this.#options.sinks ?? []) this.#written.push(await sink(report, path))
  }
}
