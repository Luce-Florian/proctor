import type { z } from "zod"
import { asError } from "../core/errors.ts"
import type { Grader } from "../ports/grader.ts"

/**
 * The shape an answer must have: how to read the final text into a structure, and the zod schema that structure
 * must satisfy. One contract per answer format; {@link answerShape} grades any of them.
 *
 * @example
 * const jsonList: AnswerContract<string[]> = { parse: (text) => JSON.parse(text), schema: z.array(z.string()).min(1) }
 */
export interface AnswerContract<T = unknown> {
  /** Reads the final text into what `schema` validates. Throwing means the text cannot be read: the criterion is missed. */
  parse(text: string): unknown
  readonly schema: z.ZodType<T>
  /** The `why` of a met criterion; default `"the answer matches its contract"`. */
  describe?(value: T): string
}

/**
 * Passes when the final text, read by `contract.parse`, satisfies `contract.schema`. One criterion `id`; when missed,
 * its `why` lists the zod issues, `path: message`, separated by `; `. Deterministic: no judge is asked.
 *
 * @example
 * c.expect(answerShape("format", yesNoContract()))                       // "non" alone, or "oui" then one line per reason
 * c.expect(answerShape("json", { parse: JSON.parse, schema: z.object({ ok: z.literal(true) }) }))
 */
export function answerShape<T>(id: string, contract: AnswerContract<T>): Grader {
  return {
    id,
    grade: async ({ result }) => {
      const { met, why } = check(contract, result.finalText)
      return { graderId: id, passed: met, criteria: [{ id, met, why }] }
    },
  }
}

function check<T>(contract: AnswerContract<T>, text: string): { met: boolean; why: string } {
  let read: unknown
  try {
    read = contract.parse(text)
  } catch (error) {
    return { met: false, why: `the answer cannot be read: ${asError(error).message}` }
  }
  const parsed = contract.schema.safeParse(read)
  if (!parsed.success) return { met: false, why: parsed.error.issues.map(issueText).join("; ") }
  return { met: true, why: contract.describe?.(parsed.data) ?? "the answer matches its contract" }
}

/** `reasons[1]: heading "## x"`: one line per issue, unlike `z.prettifyError`, so a `why` stays a single line. */
const issueText = (issue: z.core.$ZodIssue): string => {
  const path = issue.path.map((key, i) => (typeof key === "number" ? `[${key}]` : `${i > 0 ? "." : ""}${String(key)}`)).join("")
  return path === "" ? issue.message : `${path}: ${issue.message}`
}
