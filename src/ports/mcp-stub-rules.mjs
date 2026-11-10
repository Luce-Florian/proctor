// @ts-check
/**
 * How an MCP stub answers, shared by the stub program (run by the agent in the sandbox), the graders and the test
 * doubles. Plain JavaScript with no import at all (Node 22.12 runs no TypeScript), so that it runs, copied next to the
 * stub program, under any sandbox policy.
 *
 * @import { McpAnswer, McpAnsweredBy, McpInputPattern, McpStubDefinition, McpToolRule } from "./mcp-stub.ts"
 */

/** What a call no rule nor `otherwise` answers receives: a neutral tool error, no hint that the server is a stub. */
export const BUILT_IN_FALLBACK = /** @type {const} */ ({ content: "No result for these arguments.", isError: true })

/** MCP protocol version a stub answers to a client that does not send one, and that the harness sends. */
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18"

/** The key a `RegExp` is written under to cross to the stub process (JSON cannot hold one): reserved in stub data. */
export const REGEX_KEY = "$regex"

/**
 * MCP protocol versions a stub answers with: the tools shapes it uses are the same in all of them. A client asking for
 * another gets {@link DEFAULT_PROTOCOL_VERSION}, as the MCP spec lets a server answer.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]

/**
 * How a call was answered, and by what.
 * @typedef {{ readonly answer: McpAnswer, readonly answeredBy: McpAnsweredBy }} Resolution
 */

/**
 * Writes a stub definition as JSON, each `RegExp` as `{ "$regex": source, "flags": flags }`.
 *
 * @example
 * serializeStub(definition) // '{"server":"pgsql","tools":[{"name":"execute_sql","rules":[{"when":{"$regex":"reltuples","flags":""}, ...'
 *
 * @param {McpStubDefinition} definition
 * @returns {string}
 */
export function serializeStub(definition) {
  return JSON.stringify(definition, (_, /** @type {unknown} */ value) =>
    value instanceof RegExp ? { [REGEX_KEY]: value.source, flags: value.flags } : value,
  )
}

/**
 * Reads back what {@link serializeStub} wrote to `file`. The file sits in the trial home, which the agent can write: a
 * text that is not a stub definition throws, naming the file and what is wrong, so the stub does not start.
 *
 * @example
 * reviveStub(serializeStub(definition), "pgsql.json") // equal to definition
 *
 * @param {string} text
 * @param {string} file
 * @returns {McpStubDefinition}
 */
export function reviveStub(text, file) {
  /** @type {unknown} */
  let definition
  try {
    definition = JSON.parse(text, reviveRegExp)
  } catch (error) {
    throw new Error(configError(file, `not JSON (${error instanceof Error ? error.message : String(error)})`))
  }
  const problem = definitionProblem(definition)
  if (problem !== undefined) throw new Error(configError(file, problem))
  // The fields the stub reads were checked just above.
  return /** @type {McpStubDefinition} */ (definition)
}

/**
 * @param {string} _
 * @param {unknown} value
 * @returns {unknown}
 */
function reviveRegExp(_, value) {
  if (typeof value !== "object" || value === null || !(REGEX_KEY in value)) return value
  const { [REGEX_KEY]: source, flags } = /** @type {Record<string, unknown>} */ (value)
  return typeof source === "string" && typeof flags === "string" ? new RegExp(source, flags) : value
}

/**
 * @param {string} file
 * @param {string} problem
 */
const configError = (file, problem) =>
  `${file} is not an MCP stub configuration the harness wrote: ${problem}. The agent can write the trial home: check what the run did to .proctor/mcp/`

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * What is wrong with a revived stub definition, `undefined` when it has every field the stub reads.
 *
 * @param {unknown} definition
 * @returns {string | undefined}
 */
function definitionProblem(definition) {
  if (!isObject(definition)) return "not an object"
  if (typeof definition.server !== "string") return '"server" is not a string'
  if (!Array.isArray(definition.tools)) return '"tools" is not an array'
  for (const [index, tool] of definition.tools.entries()) {
    const problem = toolProblem(tool)
    if (problem !== undefined) return `tool ${index + 1}: ${problem}`
  }
  return answerProblem(definition.otherwise, "otherwise", { optional: true })
}

/**
 * @param {unknown} tool
 * @returns {string | undefined}
 */
function toolProblem(tool) {
  if (!isObject(tool)) return "not an object"
  if (typeof tool.name !== "string") return '"name" is not a string'
  if (!isObject(tool.inputSchema)) return '"inputSchema" is not an object'
  if (!Array.isArray(tool.rules)) return '"rules" is not an array'
  for (const [index, rule] of tool.rules.entries()) {
    const problem = ruleProblem(rule)
    if (problem !== undefined) return `rule ${index + 1}: ${problem}`
  }
  return answerProblem(tool.otherwise, "otherwise", { optional: true })
}

/**
 * @param {unknown} rule
 * @returns {string | undefined}
 */
function ruleProblem(rule) {
  if (!isObject(rule)) return "not an object"
  if (rule.answeredBy !== "case" && rule.answeredBy !== "stub") return '"answeredBy" is neither "case" nor "stub"'
  if (rule.when !== undefined && !(rule.when instanceof RegExp) && !isObject(rule.when)) return '"when" is not a pattern'
  if (!Array.isArray(rule.answers) || rule.answers.length === 0) return '"answers" is not a non-empty array'
  for (const [index, answer] of rule.answers.entries()) {
    const problem = answerProblem(answer, `answer ${index + 1}`, { optional: false })
    if (problem !== undefined) return problem
  }
  return undefined
}

/**
 * @param {unknown} answer
 * @param {string} name
 * @param {{ optional: boolean }} options
 * @returns {string | undefined}
 */
function answerProblem(answer, name, { optional }) {
  if (answer === undefined && optional) return undefined
  if (!isObject(answer) || typeof answer.isError !== "boolean" || !("content" in answer)) {
    return `${name} is not an answer (content and a boolean isError)`
  }
  return undefined
}

/**
 * Whether `value` matches `pattern`: a `RegExp` matches a string it finds, an array matches element by element with the
 * same length, an object matches when each of its keys is in `value` and matches (extra keys are ignored), any other
 * pattern matches an equal value.
 *
 * @param {unknown} pattern
 * @param {unknown} value
 * @returns {boolean}
 */
function matchesPattern(pattern, value) {
  if (pattern instanceof RegExp) return typeof value === "string" && value.search(pattern) !== -1
  if (Array.isArray(pattern))
    return (
      Array.isArray(value) && value.length === pattern.length && pattern.every((element, index) => matchesPattern(element, value[index]))
    )
  if (typeof pattern === "object" && pattern !== null) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    return Object.entries(pattern).every(
      ([key, expected]) => Object.hasOwn(value, key) && matchesPattern(expected, /** @type {Record<string, unknown>} */ (value)[key]),
    )
  }
  return pattern === value
}

/**
 * Whether a tool input matches `when`: any input when absent, the JSON of the whole input for a `RegExp`, else an
 * object pattern, see {@link matchesPattern}.
 *
 * @example
 * matchesInput(/reltuples/, { sql: "select reltuples from pg_class" }) // true
 * matchesInput({ object_name: /^(public\.)?orders$/ }, { instance: "prod", object_name: "public.orders" }) // true
 *
 * @param {McpInputPattern | undefined} when
 * @param {unknown} input
 * @returns {boolean}
 */
export function matchesInput(when, input) {
  if (when === undefined) return true
  if (when instanceof RegExp) return JSON.stringify(input ?? null).search(when) !== -1
  return matchesPattern(when, input)
}

/**
 * The text the agent receives for an answer: a string as is, any other value as pretty JSON.
 *
 * @example
 * answerText({ content: { rows: 1 }, isError: false }) // '{\n  "rows": 1\n}'
 *
 * @param {McpAnswer} answer
 * @returns {string}
 */
export function answerText(answer) {
  return typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content, null, 2)
}

/**
 * Answers the calls to one stub: the first matching rule of the tool (the case's come first), then the tool's
 * `otherwise`, the server's, and the built-in fallback. A rule with several answers gives them in order, then repeats
 * the last one.
 */
export class StubResponder {
  /** @type {McpStubDefinition} */
  #definition
  /** Calls each rule has answered so far, for rules that answer in order. */
  /** @type {Map<McpToolRule, number>} */
  #answered = new Map()

  /** @param {McpStubDefinition} definition */
  constructor(definition) {
    this.#definition = definition
  }

  /**
   * Resolves one call and counts it against the rule that answered.
   *
   * @example
   * new StubResponder(definition).answer("get_object_details", { object_name: "orders" }) // { answer, answeredBy: "case" }
   *
   * @param {string} toolName
   * @param {unknown} input
   * @returns {Resolution}
   */
  answer(toolName, input) {
    const tool = this.#definition.tools.find((candidate) => candidate.name === toolName)
    if (!tool) return { answer: { content: `Unknown tool "${toolName}".`, isError: true }, answeredBy: "fallback" }
    const rule = tool.rules.find((candidate) => matchesInput(candidate.when, input))
    if (rule) return { answer: this.#next(rule), answeredBy: rule.answeredBy }
    return { answer: tool.otherwise ?? this.#definition.otherwise ?? BUILT_IN_FALLBACK, answeredBy: "fallback" }
  }

  /**
   * @param {McpToolRule} rule
   * @returns {McpAnswer}
   */
  #next(rule) {
    const count = this.#answered.get(rule) ?? 0
    this.#answered.set(rule, count + 1)
    return /** @type {McpAnswer} */ (rule.answers[Math.min(count, rule.answers.length - 1)])
  }
}
