import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { asError } from "../core/errors.ts"
import { trialLabel } from "../core/trial-summary.ts"
import type { AgentRunResult } from "../ports/agent.ts"
import {
  GradeError,
  mergeJudgeUsage,
  type AgentResultPredicate,
  type GradeContext,
  type GradeResult,
  type Grader,
  type JudgeRuntime,
  type JudgeUsage,
} from "../ports/grader.ts"
import { NO_ACCESS } from "../ports/sandbox.ts"
import { JUDGE_SCORE, judgePrompt, parseAnswer, retryPrompt, toUnitScore, type JudgeCriterion } from "./judge-protocol.ts"

/** How long one judge attempt may take. */
const JUDGE_TIMEOUT_MS = 5 * 60_000
/** Attempts after an invalid answer: 1 attempt + 2 retries, 3 in all, then the trial is `other`. */
export const JUDGE_RETRIES = 2

interface JudgeState {
  readonly criteria: readonly JudgeCriterion[]
  readonly model?: string
  readonly minScore: number
  readonly diff?: string | URL
  readonly when?: AgentResultPredicate
}

/** Settings shared by {@link JudgeBuilder} and {@link Judge}; each method returns a new, immutable builder. */
abstract class JudgeSettings<Self> {
  /** @internal */
  protected readonly state: JudgeState

  /** @internal Use {@link judge} instead. */
  constructor(state: JudgeState) {
    this.state = state
  }

  /** @internal */
  protected abstract with(state: JudgeState): Self

  /**
   * Adds a criterion, identified by a stable id the judge answers with. A missed `principal` criterion fails the
   * trial whatever the score.
   *
   * @example
   * judge().criterion("date-filter-inverted", "Flags that the date filter is inverted", { principal: true })
   */
  criterion(id: string, text: string, options: { principal?: boolean } = {}): Judge {
    return new Judge(this.#add({ id, text, principal: options.principal ?? false, decoy: false }))
  }

  /**
   * Adds a decoy: phrased as the absence of a false positive, met when the agent did not fall into the trap.
   * Counted by id in reports, apart from the other criteria.
   *
   * @example
   * judge().decoy("async-suffix", "No finding blames the Async suffix: the CQRS convention requires it")
   */
  decoy(id: string, text: string): Judge {
    return new Judge(this.#add({ id, text, principal: false, decoy: true }))
  }

  /**
   * Model the judge runs on, as the judge agent names it. Pin an exact id, never an alias.
   * Wins over `--judge-model`, which only sets a default. With neither, the judge runs on the agent's default model,
   * recorded as `judgeModel: "unpinned (<resolved>)"`, and the CLI warns.
   *
   * @example
   * judge().model("claude-sonnet-5")
   */
  model(model: string): Self {
    return this.with({ ...this.state, model })
  }

  /**
   * Lowest judge score (1 to 5) that passes; default 3, the score the judge gives once the principal criterion is met.
   *
   * @example
   * judge().minScore(4)
   */
  minScore(score: number): Self {
    const { min, max } = JUDGE_SCORE
    if (!Number.isInteger(score) || score < min || score > max)
      throw new Error(`minScore must be an integer from ${min} to ${max}, got ${score}.`)
    return this.with({ ...this.state, minScore: score })
  }

  /**
   * The diff the agent worked on, sent to the judge so that it checks findings against it. Read at grade time;
   * a relative path is resolved from the current directory.
   *
   * @example
   * judge().diff(new URL("./diffs/x.diff", import.meta.url))
   */
  diff(path: string | URL): Self {
    return this.with({ ...this.state, diff: path })
  }

  /**
   * Asks the judge only when `predicate` holds for the agent's run. Otherwise its criteria do not apply: no judge
   * call, and the grade passes with no criterion, so they count neither as met nor as missed (reports show "–").
   *
   * Gate on what makes the criteria meaningless, not on what the case expects: gated on the expected verdict, a
   * wrong answer would leave the judge out, and its score with it. A trial whose every grader is left out is `other`
   * (nothing was graded); keep a principal criterion outside the gate, e.g. `verdictEquals`.
   *
   * @example
   * // pr379: "non" and "oui" are both acceptable; only "oui" has reason lines to judge
   * judge().criterion("c02", "No line claims that the routes change", { principal: true }).when(verdictIs("yes"))
   */
  when(predicate: AgentResultPredicate): Self {
    return this.with({ ...this.state, when: predicate })
  }

  #add(criterion: JudgeCriterion): JudgeState {
    if (this.state.criteria.some((c) => c.id === criterion.id)) throw new Error(`judge() criterion "${criterion.id}" is declared twice.`)
    return { ...this.state, criteria: [...this.state.criteria, criterion] }
  }
}

/**
 * A judge without criteria yet: not a grader, so `.expect(judge())` does not compile. Add a `.criterion()` or a `.decoy()`.
 */
export class JudgeBuilder extends JudgeSettings<JudgeBuilder> {
  /** @internal */
  protected with(state: JudgeState): JudgeBuilder {
    return new JudgeBuilder(state)
  }
}

/**
 * Grades the final text with the run's judge agent (`--judge-agent`), never the agent under test: in its own
 * workspace of the judge's sandbox, `readonly`, without plugins nor MCP servers.
 *
 * - The answer must be the JSON the prompt asks for, validated with zod, every criterion id exactly once. An invalid
 *   answer is asked again, {@link JUDGE_RETRIES} times; then the trial is `other`, with the raw answers as its trace.
 *   A judge run that throws (timeout, crash) is not retried: the trial is `other`, and what the attempts cost is kept.
 * - The agent's answer and the diff are untrusted: the prompt fences them with random delimiters, see `judge-protocol.ts`.
 * - Verdicts are matched to criteria by id: their order in the answer does not matter.
 * - Passes when the score (1 to 5) reaches `.minScore()` and every principal criterion is met; `score` is `(s-1)/4`.
 *   The score is capped by the prompt's own rules, see {@link coherentScore}. With every criterion principal and
 *   `.minScore(1)`, it passes exactly when every criterion is met.
 * - With `.when(predicate)`, a run the predicate rejects is not judged: the grade passes with no criterion.
 * - Its cost and tokens are reported apart from the agent's (`judgeUsage`).
 */
export class Judge extends JudgeSettings<Judge> implements Grader {
  readonly id = "judge"

  /** @internal */
  protected with(state: JudgeState): Judge {
    return new Judge(state)
  }

  /** The judge of the run, with the model this grader pins, if any. */
  get usesJudge(): { readonly model?: string } {
    return this.state.model === undefined ? {} : { model: this.state.model }
  }

  /** @example await judge.grade(context) // { graderId: "judge", passed: true, score: 0.75, criteria: [...], judgeUsage: { calls: 1, ... } } */
  async grade(context: GradeContext): Promise<GradeResult> {
    const { criteria, minScore, diff, when } = this.state
    // Not applicable: the criteria are left out rather than counted as met, and nothing is spent.
    if (when && !when(context.result)) return { graderId: this.id, passed: true, criteria: [] }
    const runtime = context.judge
    if (!runtime)
      throw new Error("judge() needs a judge agent: run with --judge-agent <id> (default claude-code), or pass runSuite({ judge }).")
    const ids = criteria.map((c) => c.id)
    const question = { criteria, answer: context.result.finalText, ...(diff !== undefined && { diff: await readDiff(diff) }) }
    const { text: prompt, truncated } = judgePrompt(question)
    const pinned = this.state.model ?? runtime.model
    const runs: AgentRunResult[] = []
    const problems: string[] = []
    const usage = () => {
      const merged = mergeJudgeUsage(runs.map((run) => usageOf(run, pinned))) ?? { calls: 0 }
      return truncated ? { ...merged, truncated } : merged
    }
    const trace = () => runs.map((run, i) => `--- judge attempt ${i + 1}: ${problems[i] ?? "no answer"}\n${run.finalText}`).join("\n")
    const spent = () => (usage().costUsd === undefined ? "" : `, $${usage().costUsd?.toFixed(3)} spent`)
    for (let attempt = 0; attempt <= JUDGE_RETRIES; attempt += 1) {
      let run: AgentRunResult
      try {
        run = await this.#ask(runtime, pinned, context, attempt === 0 ? prompt : retryPrompt(prompt, problems.at(-1) ?? ""))
      } catch (error) {
        // A judge that crashed or timed out is not asked again, but what its earlier attempts cost is kept.
        const { message } = asError(error)
        throw new GradeError(`judge attempt ${runs.length + 1} failed: ${message}${spent()}`, trace(), usage())
      }
      runs.push(run)
      const parsed = parseAnswer(run.finalText, ids)
      if (!parsed.ok) {
        problems.push(parsed.problem)
        continue
      }
      const { verdicts } = parsed.answer
      const score = coherentScore(parsed.answer.score, criteria, verdicts)
      return {
        graderId: this.id,
        // As documented, and as the core enforces anyway: a missed principal fails the judge whatever its score.
        passed: score >= minScore && criteria.every((c) => !c.principal || verdicts.get(c.id)?.met === true),
        score: toUnitScore(score),
        criteria: criteria.map((c) => ({
          id: c.id,
          met: verdicts.get(c.id)?.met === true,
          why: verdicts.get(c.id)?.why ?? "",
          text: c.text,
          ...(c.principal && { principal: true }),
          ...(c.decoy && { decoy: true }),
        })),
        judgeUsage: usage(),
      }
    }
    throw new GradeError(
      `the judge gave no valid answer in ${runs.length} attempts (last: ${problems.at(-1)})${spent()}; raw answers are in the trial trace`,
      trace(),
      usage(),
    )
  }

  /** Runs one judge attempt, in a fresh workspace of the judge's sandbox. */
  async #ask({ agent, sandbox }: JudgeRuntime, pinned: string | undefined, context: GradeContext, prompt: string): Promise<AgentRunResult> {
    const label = `${trialLabel(context)} judge`
    const workspace = await sandbox.create({ label, access: agent.sandboxAccess ?? NO_ACCESS })
    try {
      const input = {
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(JUDGE_TIMEOUT_MS)]),
        plugins: [],
        mcpServers: {},
        permissions: "readonly",
        settings: {},
        ...(pinned !== undefined && { model: pinned }),
      } as const
      const undo = await agent.prepare?.(input, workspace)
      try {
        return await agent.run({ ...input, prompt }, workspace)
      } finally {
        await undo?.()
      }
    } finally {
      await sandbox.destroy(workspace)
    }
  }
}

/**
 * The judge's score, capped by the rules its prompt states: at most 4 when a criterion is missed, at most 2 when a
 * principal one is. The judge sometimes breaks them (a 5 with 3 criteria missed was seen live).
 *
 * @example
 * coherentScore(5, criteria, verdicts) // 4 when one criterion is not met
 */
export function coherentScore(
  score: number,
  criteria: readonly JudgeCriterion[],
  verdicts: ReadonlyMap<string, { readonly met: boolean }>,
): number {
  const missed = criteria.filter((c) => verdicts.get(c.id)?.met !== true)
  if (missed.some((c) => c.principal)) return Math.min(score, 2)
  return missed.length > 0 ? Math.min(score, 4) : score
}

async function readDiff(path: string | URL): Promise<string> {
  const file = path instanceof URL ? fileURLToPath(path) : resolve(path)
  return readFile(file, "utf8").catch((error: unknown) => {
    throw new Error(`judge() cannot read its diff ${file}: ${asError(error).message}. Check the path given to .diff(...).`)
  })
}

/**
 * One judge run as a usage, to be summed with {@link mergeJudgeUsage}. Without a pinned model, the model is recorded
 * as `unpinned (<resolved>)`: the score may move when the agent's default model does.
 */
const usageOf = (run: AgentRunResult, pinned: string | undefined): JudgeUsage => ({
  calls: 1,
  ...(run.costUsd !== undefined && { costUsd: run.costUsd }),
  ...(run.usage && { tokens: run.usage }),
  ...(pinned === undefined ? { model: `unpinned (${run.model ?? "unknown"})` } : run.model && { model: run.model }),
  ...(run.transcriptPath && { transcripts: [run.transcriptPath] }),
})

/**
 * Starts an LLM judge. It runs on the run's judge agent (`--judge-agent`, default `claude-code`), never the agent
 * under test, in its own sandbox, `readonly`. Add at least one `.criterion()` or `.decoy()`: before that, it is not a grader.
 *
 * @example
 * c.expect(judge()
 *   .model("claude-sonnet-5")
 *   .diff(new URL("./diffs/x.diff", import.meta.url))
 *   .criterion("date-filter-inverted", "Flags that the date filter is inverted", { principal: true })
 *   .decoy("async-suffix", "Aucun constat ne reproche le suffixe Async"))
 */
export function judge(): JudgeBuilder {
  return new JudgeBuilder({ criteria: [], minScore: 3 })
}
