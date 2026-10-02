import { clip, MAX_QUOTED } from "../shared/text.ts"
import type { AgentResultPredicate, Grader } from "../ports/grader.ts"

/** A yes/no verdict, whatever the words of the contract. */
export type Verdict = "yes" | "no"

/** The words an answer uses for each verdict. */
export interface VerdictWords {
  readonly yes: string
  readonly no: string
}

export interface VerdictOptions {
  /** The words of the contract. Default `{ yes: "oui", no: "non" }`, as `/sdlc:check-if-need-humain-review` answers. */
  readonly words?: VerdictWords
}

/** The words of `/sdlc:check-if-need-humain-review`. */
export const DEFAULT_WORDS: VerdictWords = { yes: "oui", no: "non" }

/**
 * The lines of an answer: trimmed as a whole (surrounding blanks, BOM), split on LF or CRLF. The first one, trimmed,
 * is where the verdict stands; {@link verdictEquals}, {@link verdictIs} and `yesNoContract` all read it here.
 *
 * @example
 * answerLines("\uFEFFoui\r\n- migration\n") // { first: "oui", rest: ["- migration"] }
 */
export function answerLines(text: string): { readonly first: string; readonly rest: readonly string[] } {
  const [first = "", ...rest] = text.trim().split(/\r?\n/)
  return { first: first.trim(), rest }
}

/**
 * The verdict of an answer: its first line is exactly one of the verdict words, case included; `undefined` otherwise.
 * Strict on purpose: `**Oui**`, `Oui`, `non.` or a verdict on a later line are no verdict, so the verdict criterion,
 * the gate and the shape of the answer never disagree.
 *
 * @example
 * readVerdict("oui\n- migration") // "yes"
 * readVerdict("**Non.**")          // undefined
 */
export function readVerdict(text: string, words: VerdictWords = DEFAULT_WORDS): Verdict | undefined {
  const { first } = answerLines(text)
  if (first === words.yes) return "yes"
  if (first === words.no) return "no"
  return undefined
}

/**
 * The verdict words, quoted and joined, for a `why` or a criterion text.
 *
 * @example
 * quoteVerdicts(["no", "yes"])              // '"non" or "oui"'
 * quoteVerdicts(["no", "yes"], undefined, "ou") // '"non" ou "oui"'
 */
export function quoteVerdicts(verdicts: readonly Verdict[], words: VerdictWords = DEFAULT_WORDS, separator = "or"): string {
  return verdicts.map((v) => `"${words[v]}"`).join(` ${separator} `)
}

/**
 * Passes when the verdict of the final text, read by {@link readVerdict}, is `expected` (or one of them): its first
 * line is exactly the verdict word. Its one criterion is principal. Only the verdict: the shape of the answer is
 * `answerShape(id, yesNoContract())`'s. Deterministic: no judge is asked.
 *
 * @example
 * c.expect(verdictEquals("verdict", "no"))
 * c.expect(verdictEquals("verdict", ["no", "yes"]))   // either verdict is acceptable
 */
export function verdictEquals(id: string, expected: Verdict | readonly Verdict[], options: VerdictOptions = {}): Grader {
  const accepted: readonly Verdict[] = typeof expected === "string" ? [expected] : expected
  const words = options.words ?? DEFAULT_WORDS
  const wanted = quoteVerdicts(accepted, words)
  return {
    id,
    grade: async ({ result }) => {
      const found = readVerdict(result.finalText, words)
      const met = found !== undefined && accepted.includes(found)
      const why =
        found === undefined
          ? `the first line ${JSON.stringify(clip(answerLines(result.finalText).first, MAX_QUOTED))} is no verdict, expected ${wanted} alone`
          : `verdict "${words[found]}", expected ${wanted}`
      // The verdict is what the answer carries: missing it fails the trial whatever else passes.
      return { graderId: id, passed: met, criteria: [{ id, met, why, principal: true }] }
    },
  }
}

/**
 * Holds when the verdict of the final text, read by {@link readVerdict} as {@link verdictEquals} reads it, is
 * `verdict`. A gate for a grader that only makes sense for one verdict, e.g. a judge of the reason lines that follow
 * `oui`, on a case where either verdict is acceptable.
 *
 * @example
 * judge().criterion("c02", "No line claims that the routes change").when(verdictIs("yes"))
 */
export function verdictIs(verdict: Verdict, options: VerdictOptions = {}): AgentResultPredicate {
  const words = options.words ?? DEFAULT_WORDS
  return (result) => readVerdict(result.finalText, words) === verdict
}
