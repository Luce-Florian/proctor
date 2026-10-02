/**
 * Judges again the trials of an archived run, from their claude-code transcripts, without running the agent:
 * measures the judge's stability, or compares two judge prompts at equal answers.
 *
 * @example
 * CLAUDE_CODE_OAUTH_TOKEN=… npm run rejudge -- results/review/<runId>.ctrf.json ../review/review.eval.ts --times 3 --test "baseline] #1"
 */
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { timestampedId } from "../src/shared/ids.ts"
import { ClaudeCodeAdapter } from "../src/adapters/agents/claude-code/adapter.ts"
import { CLAUDE_AUTH_PROFILES } from "../src/adapters/agents/claude-code/credentials.ts"
import { StreamCollector } from "../src/adapters/agents/claude-code/stream-parser.ts"
import { SrtSandbox } from "../src/adapters/sandboxes/srt/sandbox.ts"
import { resolveCredential } from "../src/auth/credential-resolver.ts"
import { fromUnitScore } from "../src/graders/judge-protocol.ts"
import { Judge } from "../src/graders/llm-judge.ts"
import { loadSuite } from "../src/loaders/index.ts"
import type { CriterionVerdict } from "../src/ports/grader.ts"
import { readCtrf } from "../src/reporters/ctrf.ts"
import type { CtrfTest } from "../src/reporters/ctrf-types.ts"
import { writeTextFile } from "../src/reporters/files.ts"

/** What one grade says, in the units the stability measure compares: criteria met, judge score from 1 to 5. */
export interface GradeSummary {
  readonly met: number
  readonly total: number
  readonly score?: number
  readonly missed: readonly string[]
}

/**
 * @example
 * summarize({ criteria: [{ id: "c01", met: false }], score: 0.25 }) // { met: 0, total: 1, score: 2, missed: ["c01"] }
 */
export const summarize = (grade: {
  readonly criteria: readonly CriterionVerdict[]
  readonly score?: number | undefined
}): GradeSummary => ({
  met: grade.criteria.filter((c) => c.met).length,
  total: grade.criteria.length,
  ...(grade.score !== undefined && { score: fromUnitScore(grade.score) }),
  missed: grade.criteria.filter((c) => !c.met).map((c) => c.id),
})

const JUDGE_GRADERS = ["judge", "llm-judge"]

/**
 * The archived verdict of the judge alone, what a rejudge compares with: the criteria of the other graders
 * (`limits`, `regex`…) are left out. The score is the trial's, which only `judge()` sets among the built-in graders.
 *
 * @example
 * archivedJudge(test) // { met: 3, total: 4, score: 4, missed: ["c02"] }
 */
export function archivedJudge(test: CtrfTest): GradeSummary {
  // "llm-judge": the grader id of the phase 2 runs, before judge() replaced llmJudge().
  const criteria = ((test.extra?.criteria ?? []) as (CriterionVerdict & { grader?: string })[]).filter((c) =>
    JUDGE_GRADERS.includes(c.grader ?? ""),
  )
  const score = test.extra?.score
  return summarize({ criteria, ...(typeof score === "number" && { score }) })
}

async function main(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      times: { type: "string", default: "3" },
      test: { type: "string" },
      model: { type: "string" },
      out: { type: "string", default: "results" },
    },
  })
  const [ctrfFile, suitePath] = positionals
  if (!ctrfFile || !suitePath)
    throw new Error("usage: rejudge <run.ctrf.json> <suite> [--times 3] [--test <name part>] [--model <id>] [--out results]")

  const report = await readCtrf(resolve(ctrfFile))
  const definition = await loadSuite(resolve(suitePath))
  const outDir = resolve(values.out)
  const judge = {
    agent: new ClaudeCodeAdapter({
      credential: resolveCredential("claude-code", CLAUDE_AUTH_PROFILES, process.env),
      transcriptsDir: join(outDir, "transcripts"),
    }),
    sandbox: new SrtSandbox(),
    ...(values.model !== undefined && { model: values.model }),
  }

  const rows = []
  for (const test of report.results.tests.filter((t) => values.test === undefined || t.name.includes(values.test))) {
    const [, caseId, variant] = test.suite ?? []
    const graders = definition.cases.find((c) => c.id === caseId)?.graders.filter((g) => g instanceof Judge) ?? []
    const transcript = test.extra?.transcript
    if (graders.length === 0 || typeof transcript !== "string" || !caseId || !variant) continue
    const stream = new StreamCollector()
    for (const line of (await readFile(transcript, "utf8")).split("\n")) stream.add(line)
    const result = stream.finish({ durationMs: test.duration })
    const rejudged = []
    // A judge grader never reads the trial workspace: it runs in its own sandbox.
    const workspace = { cwd: tmpdir(), home: tmpdir(), env: {} }
    const context = {
      caseId,
      variant,
      trial: Number(test.labels?.trial ?? 1),
      result,
      workspace,
      judge,
      signal: new AbortController().signal,
    }
    for (let i = 0; i < Number(values.times); i += 1) {
      for (const grader of graders) {
        const grade = await grader.grade(context)
        rejudged.push({ ...summarize(grade), costUsd: grade.judgeUsage?.costUsd, calls: grade.judgeUsage?.calls })
        process.stdout.write(`${test.name} #${i + 1}: ${JSON.stringify(rejudged.at(-1))}\n`)
      }
    }
    rows.push({ test: test.name, archived: archivedJudge(test), rejudged })
  }

  const target = join(outDir, "rejudge", `${report.runId ?? "run"}-${timestampedId(2)}.json`)
  await writeTextFile(target, `${JSON.stringify(rows, null, 2)}\n`)
  process.stdout.write(`Wrote ${target}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2))
