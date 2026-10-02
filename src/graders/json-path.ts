import { isDeepStrictEqual } from "node:util"
import { asError } from "../core/errors.ts"
import { clip } from "../shared/text.ts"
import type { Grader } from "../ports/grader.ts"
import { stripFences } from "./judge-protocol.ts"
import { readWorkspaceFile, workspaceEscape } from "./workspace-files.ts"

/** What the value at the path must be: equal to a value, match a pattern (strings), or satisfy a predicate. */
export type JsonExpectation =
  string | number | boolean | null | readonly unknown[] | Record<string, unknown> | RegExp | ((value: unknown) => boolean)

export interface JsonPathOptions {
  /** Read the JSON from this file of the workspace instead of the final text: a relative path; symbolic links are refused. */
  readonly file?: string
}

/**
 * Splits `$.a.b[0].c` into `["a", "b", 0, "c"]`.
 *
 * @example
 * parseJsonPath("$.findings[0].file") // ["findings", 0, "file"]
 */
export function parseJsonPath(path: string): (string | number)[] {
  if (!/^\$((\.[A-Za-z_$][\w$-]*)|(\[\d+\]))*$/.test(path)) {
    throw new Error(`Invalid JSON path "${path}": use $.key.other[0], e.g. "$.verdict" or "$.findings[0].file".`)
  }
  return [...path.slice(1).matchAll(/\.([^.[]+)|\[(\d+)\]/g)].map((m) => (m[2] === undefined ? (m[1] ?? "") : Number(m[2])))
}

function valueAt(json: unknown, steps: readonly (string | number)[]): { found: boolean; value?: unknown } {
  let value = json
  for (const step of steps) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, step)) return { found: false }
    value = (value as Record<string | number, unknown>)[step]
  }
  return { found: true, value }
}

function satisfies(value: unknown, expected: JsonExpectation): boolean {
  if (expected instanceof RegExp) return typeof value === "string" && value.search(expected) !== -1
  if (typeof expected === "function") return expected(value)
  return isDeepStrictEqual(value, expected)
}

function describeExpectation(expected: JsonExpectation): string {
  if (expected instanceof RegExp) return `matching ${expected}`
  if (typeof expected === "function") return "satisfying the predicate"
  return show(expected)
}

const show = (value: unknown) => {
  // JSON.stringify returns undefined for undefined, a function or a symbol, whatever its declared type says.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const text = JSON.stringify(value) ?? String(value)
  return clip(text, 80)
}

/**
 * Passes when the JSON answered by the agent (its final text, or a file it wrote) holds the expected value at `path`.
 * An answer that is not JSON fails the criterion, it does not make the trial `other`.
 *
 * @example
 * c.expect(jsonPath("verdict-yes", "$.verdict", "oui"))
 * c.expect(jsonPath("three-findings", "$.findings.length", (n) => n === 3, { file: "review.json" }))
 */
export function jsonPath(id: string, path: string, expected: JsonExpectation, options: JsonPathOptions = {}): Grader {
  const steps = parseJsonPath(path)
  const escape = options.file === undefined ? undefined : workspaceEscape(options.file)
  if (escape) throw new Error(`jsonPath "${id}": file ${escape}`)
  const source = options.file === undefined ? "the final text" : `"${options.file}"`
  const describe = describeExpectation(expected)
  return {
    id,
    grade: async ({ result, workspace }) => {
      const verdict = (met: boolean, why: string) => ({ graderId: id, passed: met, criteria: [{ id, met, why }] })
      let text = result.finalText
      if (options.file !== undefined) {
        try {
          text = await readWorkspaceFile(workspace.cwd, options.file)
        } catch (error) {
          return verdict(false, `cannot read ${source}: ${asError(error).message}`)
        }
      }
      let json: unknown
      try {
        json = JSON.parse(stripFences(text))
      } catch (error) {
        return verdict(false, `${source} is not JSON: ${asError(error).message}`)
      }
      const { found, value } = valueAt(json, steps)
      if (!found) return verdict(false, `${source} has no ${path}`)
      const met = satisfies(value, expected)
      return verdict(met, `${path} is ${show(value)}${met ? "" : `, expected ${describe}`}`)
    },
  }
}
