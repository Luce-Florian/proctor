import { z } from "zod"
import { clip, MAX_QUOTED } from "../shared/text.ts"
import type { AnswerContract } from "./answer-shape.ts"
import { answerLines, DEFAULT_WORDS, quoteVerdicts, type Verdict, type VerdictOptions } from "./verdict-equals.ts"

/** A yes/no answer read by {@link yesNoContract}: the verdict of its first line, then one reason per line. */
export interface YesNoAnswer {
  readonly verdict: Verdict
  readonly reasons: readonly string[]
}

export interface YesNoContractOptions extends VerdictOptions {
  /** The verdicts a well-formed answer may carry; default both. `["no"]` reads "the output is strictly `non`". */
  readonly verdicts?: readonly Verdict[]
  /** Longest reason line, in characters; beyond, it is a paragraph, not a line. Default {@link MAX_REASON_LENGTH}. */
  readonly maxReasonLength?: number
}

/**
 * Default longest reason line. Calibrated on the recorded `check-human-review` answers: 9 reason lines in 10 are under
 * 500 characters; the longer ones explain, recommend or chain several patterns.
 */
export const MAX_REASON_LENGTH = 500

/** Bullets and emphasis a line may open with: `- `, `* `, `**`, `_`. */
const LEAD = String.raw`^\s*(?:[-*•]\s+)?[*_]*\s*`
/** `confiance: haute`, `**Confiance : moyenne**`, `- Confiance « moyenne » plutôt que…`, as recorded runs wrote them. */
const CONFIDENCE = new RegExp(String.raw`${LEAD}(niveau de\s+)?(confiance|confidence)\b`, "i")
/** `Recommandation : …`, `Je recommande…`, `We recommend…`; not `Règle de recommandation de paiement modifiée`. */
const RECOMMENDATION = new RegExp(
  String.raw`${LEAD}(?:(recommandations?|recommendations?)\s*[*_]*\s*:|(je|nous|i|we)\s+(recommand|recommend))`,
  "i",
)

/**
 * What a reason line must not be, and how an issue names it. Each pattern is anchored on the shape of the line, not
 * on a word anywhere in it: `- abaisse le seuil de confiance` or `Tiers de confiance : …` are reasons.
 */
const OFF_CONTRACT: readonly (readonly [string, (line: string) => boolean])[] = [
  ["blank line", (line) => line.trim() === ""],
  // A markdown heading (`#` then a space: `#1234 migration` is a reason), or a label line ending with `:`.
  ["heading", (line) => /^\s*#{1,6}(\s|$)/.test(line) || /:\s*[*_]*\s*$/.test(line)],
  ["confidence level", (line) => CONFIDENCE.test(line)],
  ["recommendation", (line) => RECOMMENDATION.test(line)],
]

const quote = (line: string) => JSON.stringify(clip(line, MAX_QUOTED))

/**
 * The contract of a yes/no answer, for {@link answerShape}:
 *
 * | Answer | Well-formed when |
 * |---|---|
 * | `non` | the word alone, nothing after it |
 * | `oui` | the word alone on its first line, then at least one reason line: no blank line, heading (`# …`, or a line ending with `:`), line opening on a confidence level (`confiance…`) or a recommendation (`Recommandation :`, `Je recommande…`), nor line longer than `maxReasonLength` |
 *
 * The first line is the word exactly, surrounding blanks aside, as `readVerdict` reads it: `**Oui**` or `review: oui`
 * carry no verdict and are off contract.
 *
 * The defaults are those of `/sdlc:check-if-need-humain-review` (French words and keywords, 500 characters); another
 * skill with a yes/no answer overrides `words` and `maxReasonLength`, a different format is another contract. Issues are reported on `verdict` and `reasons[i]` (line `i + 2`).
 *
 * @example
 * c.expect(answerShape("format", yesNoContract()))
 * c.expect(answerShape("format", yesNoContract({ verdicts: ["no"] })))            // "non", and nothing else
 * c.expect(answerShape("format", yesNoContract({ words: { yes: "yes", no: "no" }, maxReasonLength: 200 })))
 */
export function yesNoContract(options: YesNoContractOptions = {}): AnswerContract<YesNoAnswer> {
  const words = options.words ?? DEFAULT_WORDS
  const verdicts = options.verdicts ?? ["no", "yes"]
  const max = options.maxReasonLength ?? MAX_REASON_LENGTH
  if (verdicts.length === 0) throw new Error("yesNoContract({ verdicts }) needs at least one verdict.")
  if (!Number.isInteger(max) || max < 1) throw new Error(`yesNoContract({ maxReasonLength }) must be a positive integer, got ${max}.`)
  const reason = z.string().superRefine((line, ctx) => {
    for (const [label, breaks] of OFF_CONTRACT) if (breaks(line)) ctx.addIssue({ code: "custom", message: `${label} ${quote(line)}` })
    if (line.length > max)
      ctx.addIssue({ code: "custom", message: `paragraph of ${line.length} characters, at most ${max} per reason line` })
  })
  const shapes = {
    no: z.array(z.string()).max(0, `"${words.no}" must stand alone`),
    yes: z.array(reason).min(1, `"${words.yes}" must be followed by one line per reason`),
  }
  const [first, ...others] = verdicts.map((v) => z.object({ verdict: z.literal(words[v]), reasons: shapes[v] }))
  const wanted = quoteVerdicts(verdicts, words)
  if (first === undefined) throw new Error("yesNoContract({ verdicts }) needs at least one verdict.")
  const union = z.discriminatedUnion("verdict", [first, ...others], { error: `the first line must be ${wanted} alone` })
  return {
    parse: (text) => {
      const { first, rest } = answerLines(text)
      return { verdict: first, reasons: rest.map((line) => line.trimEnd()) }
    },
    schema: union.transform((a): YesNoAnswer => ({ verdict: a.verdict === words.yes ? "yes" : "no", reasons: a.reasons })),
    describe: ({ verdict, reasons }) => (verdict === "no" ? `"${words.no}" alone` : `"${words.yes}" then ${reasons.length} reason line(s)`),
  }
}
