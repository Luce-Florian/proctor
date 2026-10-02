import { answerShape } from "../graders/answer-shape.ts"
import { Judge, type JudgeBuilder } from "../graders/llm-judge.ts"
import { DEFAULT_WORDS, quoteVerdicts, verdictEquals, verdictIs, type Verdict } from "../graders/verdict-equals.ts"
import { yesNoContract } from "../graders/yes-no-contract.ts"
import type { Grader } from "../ports/grader.ts"

/** What a criterion of a yes/no legacy case checks. */
export type VerdictRole = "verdict" | "format" | "semantic"

/** The criteria of a yes/no case of the bash bench (`check-human-review`), sorted by what they check. */
export interface VerdictCriteria {
  readonly accepted: readonly Verdict[]
  /** Role of each criterion, in order. */
  readonly roles: readonly VerdictRole[]
}

const VERDICT_OF: Readonly<Record<string, Verdict>> = { [DEFAULT_WORDS.yes]: "yes", [DEFAULT_WORDS.no]: "no" }

/** The verdict a word captured by `VERDICT` or `EITHER` stands for. */
function verdictOf(word: string): Verdict {
  const verdict = VERDICT_OF[word]
  if (verdict === undefined) throw new Error(`"${word}" is not a verdict word: expected "${DEFAULT_WORDS.yes}" or "${DEFAULT_WORDS.no}".`)
  return verdict
}

/** `Rend le verdict "non"…` */
const VERDICT = /^Rend le verdict "(oui|non)"/
/** `S'il répond "non", la sortie est strictement "non"… ; s'il répond "oui" par prudence…, la sortie est…`: either verdict, in its format. */
const EITHER = /^S'il répond "(oui|non)", la sortie est .*; s'il répond "(oui|non)"[^;]*, la sortie est/
/** Criteria about the shape of the whole answer. */
const FORMAT = [
  /^La sortie est strictement "(oui|non)"/,
  /^La sortie est "oui" suivi uniquement d'une ligne par pattern/,
  /^Aucun texte hors du contrat/,
]

/**
 * Recognises the yes/no contract of a legacy case from its criteria texts, as `check-human-review` writes them.
 * Returns `undefined` when no criterion states the expected verdict: the case stays with the judge.
 *
 * | Criterion | Role |
 * |---|---|
 * | `Rend le verdict "non"…` | `verdict` |
 * | `S'il répond "non", la sortie est … ; s'il répond "oui", la sortie est …` | `format`, either verdict accepted |
 * | `La sortie est strictement "non"…`, `La sortie est "oui" suivi uniquement d'une ligne par pattern…`, `Aucun texte hors du contrat…` | `format` |
 * | anything else, e.g. `Une des lignes identifie une migration…` | `semantic`: about the reason lines, for the judge |
 *
 * @example
 * classify(['Rend le verdict "non"', 'La sortie est strictement "non", rien d\'autre'])
 * // { accepted: ["no"], roles: ["verdict", "format"] }
 */
export function classify(criteria: readonly string[]): VerdictCriteria | undefined {
  let accepted: Verdict[] | undefined
  const roles: VerdictRole[] = []
  for (const text of criteria) {
    const single = VERDICT.exec(text)?.[1]
    const either = single === undefined ? EITHER.exec(text) : null
    if (single) {
      accepted = [verdictOf(single)]
      roles.push("verdict")
    } else if (either?.[1] && either[2]) {
      accepted = [verdictOf(either[1]), verdictOf(either[2])]
      roles.push("format")
    } else roles.push(FORMAT.some((f) => f.test(text)) ? "format" : "semantic")
  }
  return accepted && { accepted, roles }
}

/**
 * The graders of a yes/no legacy case, or `undefined` when its criteria are not a yes/no contract. Criteria keep their
 * legacy ids (`c01`…) and texts, in three tiers:
 *
 * | Role | Grader |
 * |---|---|
 * | `verdict` | `verdictEquals`, principal |
 * | `format` | `answerShape` with `yesNoContract({ verdicts })`, the verdicts the case accepts |
 * | `semantic` | one `judge` from `base`, every criterion principal, `.minScore(1)`: passes exactly when all are met; `.when(verdictIs("yes"))` only when `non` is also accepted (pr379): the criteria are about the reason lines, which a valid `non` does not have, while on a case that expects `oui` a `non` misses them |
 *
 * When no criterion states the expected verdict (both accepted, pr379), the verdict is added as a principal criterion
 * `verdict`: a trial always has a principal.
 *
 * @example
 * verdictGraders(legacy.expected.criteria, judge().model(LEGACY_JUDGE_MODEL))
 * // [verdictEquals c01, answerShape c02, judge c03]; on pr379: [verdictEquals verdict, answerShape c01, answerShape c03, judge c02 gated on "oui"]
 */
export function verdictGraders(criteria: readonly string[], base: JudgeBuilder): Grader[] | undefined {
  const classified = classify(criteria)
  if (!classified) return undefined
  const { accepted, roles } = classified
  const graders: Grader[] = []
  if (!roles.includes("verdict")) {
    graders.push(withText(verdictEquals("verdict", accepted), `Rend un verdict ${quoteVerdicts(accepted, DEFAULT_WORDS, "ou")}`))
  }
  let semantic: JudgeBuilder | Judge = base
  for (const [index, text] of criteria.entries()) {
    const id = legacyId(index)
    const role = roles[index]
    if (role === "verdict") graders.push(withText(verdictEquals(id, accepted), text))
    else if (role === "format") graders.push(withText(answerShape(id, yesNoContract({ verdicts: accepted })), text))
    else semantic = semantic.criterion(id, text, { principal: true })
  }
  if (semantic instanceof Judge) {
    const judged = semantic.minScore(1)
    // Gated only where "non" is a valid answer: on a case that expects "oui", a "non" misses the reason lines, and the
    // judge says so, as judge.sh did. Gating there would leave a wrong verdict without a score.
    graders.push(accepted.includes("no") ? judged.when(verdictIs("yes")) : judged)
  }
  return graders
}

/** The grader, its criteria carrying the legacy text. */
function withText(grader: Grader, text: string): Grader {
  return {
    id: grader.id,
    grade: async (context) => {
      const grade = await grader.grade(context)
      return { ...grade, criteria: grade.criteria.map((c) => ({ ...c, text })) }
    },
  }
}

/** Id of the n-th criterion of a legacy case: `c01`, `c02`… */
export const legacyId = (index: number): string => `c${String(index + 1).padStart(2, "0")}`
