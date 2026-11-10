import { z } from "zod"
import type { JsonPattern, McpAnswer, McpStubDefinition, McpStubRule, McpToolDefinition, McpToolRule } from "../ports/mcp-stub.ts"
import { duplicates } from "../shared/arrays.ts"
import type { CaseDefinition, McpCaseRule, McpCaseRules, VariantDefinition } from "./model.ts"

/** An issue found in the MCP stubs of a suite: a path the suite schema turns into `variant "y" > ...`, and what to do. */
export interface McpStubIssue {
  readonly path: (string | number)[]
  readonly message: string
}

/** Server and tool names, as every agent accepts them in a tool name. */
const STUB_NAME = /^[A-Za-z0-9_-]+$/

const NAME_RULE = 'MCP stub and tool names may contain only letters, digits, "_" and "-": rename it'
const NOT_A_PATTERN = "predicates cannot cross to the stub process; use an object pattern or a RegExp"
const NOT_JSON = "answers must be JSON (a string, number, boolean, null, array or plain object); read files and compute values before"
const SCHEMA_NOT_JSON = "must be a JSON object, as the real server sends it in tools/list"

/** The key a `RegExp` is written under to cross to the stub process: a stub definition cannot use it for its own data. */
const REGEX_KEY = "$regex"
const RESERVED_KEY = `the key "${REGEX_KEY}" is reserved for RegExp serialization; rename it`

/** A value `JSON.stringify` writes and `JSON.parse` reads back unchanged: no function, class instance, `undefined` or `NaN`. */
const jsonValue = z.json()
const jsonObject = z.record(z.string(), jsonValue)

/** A JSON value in which a `RegExp` may stand for a string. */
const jsonPattern: z.ZodType<JsonPattern> = z.lazy(() =>
  z.union([z.instanceof(RegExp), z.array(jsonPattern), z.record(z.string(), jsonPattern), z.string(), z.number(), z.boolean(), z.null()]),
)
const inputPattern = z.union([z.instanceof(RegExp), z.record(z.string(), jsonPattern)])

/**
 * Merges the rules a case declares into the stubs of a variant: the case rules of a tool, tagged `"case"`, go before the
 * stub's own. A case's rules for a stub the variant does not declare are ignored, so a variant without the stub runs
 * without the server.
 *
 * @example
 * stubsFor(variant, testCase) // [{ server: "pgsql", tools: [{ name: "get_object_details", rules: [{ answeredBy: "case", ... }, ...] }] }]
 */
export function stubsFor(
  variant: Pick<VariantDefinition, "mcpStubs">,
  testCase: Pick<CaseDefinition, "mcpStubRules">,
): McpStubDefinition[] {
  return variant.mcpStubs.map((stub) => {
    const caseRules = caseRulesOf(testCase.mcpStubRules, stub.server)
    return { ...stub, tools: stub.tools.map((tool) => withCaseRules(tool, caseRules)) }
  })
}

function withCaseRules(tool: McpToolDefinition, caseRules: readonly McpCaseRule[]): McpToolDefinition {
  const fromCase = caseRules
    .filter((rule) => rule.tool === tool.name)
    .map(({ tool: _, ...rule }): McpToolRule => ({ ...rule, answeredBy: "case" }))
  return { ...tool, rules: [...fromCase, ...tool.rules] }
}

/** The rules a case declares for the stub `server`, every `c.mcpStub(...)` call in declaration order. */
const caseRulesOf = (entries: readonly McpCaseRules[], server: string): McpCaseRule[] =>
  entries.filter((entry) => entry.server === server).flatMap((entry) => entry.rules)

/**
 * Checks the MCP stubs of a suite: names, duplicates, serializable rules and answers, and case rules that match a stub
 * of a variant. Returns one issue per problem; none means the stubs can run.
 *
 * @example
 * mcpStubIssues(suite) // [{ path: ["cases", 0, 'mcpStub "pgsql"'], message: "no variant declares this MCP stub; ..." }]
 */
export function mcpStubIssues(suite: {
  readonly variants: readonly Pick<VariantDefinition, "name" | "mcpStubs" | "mcpServers">[]
  readonly cases: readonly Pick<CaseDefinition, "mcpStubRules">[]
}): McpStubIssue[] {
  return [
    ...suite.variants.flatMap((variant, index) => under(["variants", index], variantIssues(variant))),
    ...suite.cases.flatMap((testCase, index) => under(["cases", index], caseIssues(testCase.mcpStubRules, suite.variants))),
  ]
}

/** The issues found under `prefix`, e.g. `["variants", 0]`. */
const under = (prefix: readonly (string | number)[], issues: readonly McpStubIssue[]): McpStubIssue[] =>
  issues.map(({ path, message }) => ({ path: [...prefix, ...path], message }))

/** No issue when `valid`, else one issue at `path`. */
const issueUnless = (valid: boolean, path: (string | number)[], message: string): McpStubIssue[] => (valid ? [] : [{ path, message }])

const stubLabel = (server: string) => `mcpStub "${server}"`

function variantIssues(variant: Pick<VariantDefinition, "mcpStubs" | "mcpServers">): McpStubIssue[] {
  const names = [...variant.mcpStubs.map((stub) => stub.server), ...Object.keys(variant.mcpServers)]
  return [
    ...duplicates(names).map((name) => ({ path: [], message: `"${name}" is declared twice; rename one` })),
    ...variant.mcpStubs.flatMap((stub) => under([stubLabel(stub.server)], stubIssues(stub))),
  ]
}

function stubIssues(stub: McpStubDefinition): McpStubIssue[] {
  return [
    ...issueUnless(STUB_NAME.test(stub.server), [], NAME_RULE),
    ...duplicates(stub.tools.map((tool) => tool.name)).map((name) => ({
      path: [],
      message: `tool "${name}" is declared twice; rename one`,
    })),
    ...issueUnless(stub.otherwise === undefined || isAnswer(stub.otherwise), ["otherwise"], NOT_JSON),
    ...reservedKeyIssues(["otherwise"], stub.otherwise?.content),
    ...stub.tools.flatMap((tool) => under([tool.name], toolIssues(tool))),
  ]
}

function toolIssues(tool: McpToolDefinition): McpStubIssue[] {
  return [
    ...issueUnless(STUB_NAME.test(tool.name), [], NAME_RULE),
    ...issueUnless(jsonObject.safeParse(tool.inputSchema).success, ["inputSchema"], SCHEMA_NOT_JSON),
    ...issueUnless(tool.otherwise === undefined || isAnswer(tool.otherwise), ["otherwise"], NOT_JSON),
    ...reservedKeyIssues(["inputSchema"], tool.inputSchema),
    ...reservedKeyIssues(["otherwise"], tool.otherwise?.content),
    ...rulesIssues(tool.rules),
  ]
}

function caseIssues(entries: readonly McpCaseRules[], variants: readonly Pick<VariantDefinition, "name" | "mcpStubs">[]): McpStubIssue[] {
  const servers = [...new Set(entries.map((entry) => entry.server))]
  return servers.flatMap((server) => {
    const rulesByTool = groupByTool(caseRulesOf(entries, server))
    const declaring = variants.flatMap((variant) =>
      variant.mcpStubs.filter((stub) => stub.server === server).map((stub) => ({ variant: variant.name, stub })),
    )
    return [
      ...under([stubLabel(server)], undeclaredStubIssue(server, declaring.length)),
      ...declaring.flatMap(({ variant, stub }) =>
        under([`variant "${variant}"`, stubLabel(server)], unknownToolIssues(stub, [...rulesByTool.keys()])),
      ),
      ...under([stubLabel(server)], caseRuleIssues(rulesByTool)),
    ]
  })
}

function groupByTool(rules: readonly McpCaseRule[]): Map<string, McpCaseRule[]> {
  const byTool = new Map<string, McpCaseRule[]>()
  for (const rule of rules) byTool.set(rule.tool, [...(byTool.get(rule.tool) ?? []), rule])
  return byTool
}

const undeclaredStubIssue = (server: string, declaringVariants: number): McpStubIssue[] =>
  issueUnless(
    declaringVariants > 0,
    [],
    `no variant declares this MCP stub; pass the mcpStub("${server}") value to .mcpStub(...) on a variant`,
  )

function unknownToolIssues(stub: McpStubDefinition, tools: readonly string[]): McpStubIssue[] {
  const declared = stub.tools.map((tool) => tool.name)
  return tools
    .filter((tool) => !declared.includes(tool))
    .map((tool) => ({ path: [], message: `no tool "${tool}"; declare it on the mcpStub("${stub.server}") the variant uses` }))
}

const caseRuleIssues = (rulesByTool: ReadonlyMap<string, readonly McpCaseRule[]>): McpStubIssue[] =>
  [...rulesByTool].flatMap(([tool, rules]) => under([tool], rulesIssues(rules)))

const rulesIssues = (rules: readonly McpStubRule[]): McpStubIssue[] =>
  rules.flatMap((rule, index) => under([`rule ${index + 1}`], ruleIssues(rule)))

function ruleIssues(rule: McpStubRule): McpStubIssue[] {
  return [
    ...issueUnless(rule.when === undefined || inputPattern.safeParse(rule.when).success, [], NOT_A_PATTERN),
    ...issueUnless(rule.answers.length > 0 && rule.answers.every(isAnswer), [], NOT_JSON),
    ...reservedKeyIssues(["when"], rule.when),
    ...rule.answers.flatMap((answer, index) => reservedKeyIssues([`answer ${index + 1}`], answer.content)),
  ]
}

/** An issue at the first {@link REGEX_KEY} key in `value`, under `path`: the stub process would revive it as a `RegExp`. */
function reservedKeyIssues(path: (string | number)[], value: unknown): McpStubIssue[] {
  const at = reservedKeyPath(value)
  return at ? [{ path: [...path, ...at], message: RESERVED_KEY }] : []
}

/** The path to the first {@link REGEX_KEY} key in a JSON value or pattern, `undefined` when it has none. */
function reservedKeyPath(value: unknown): (string | number)[] | undefined {
  if (typeof value !== "object" || value === null || value instanceof RegExp) return undefined
  for (const [key, child] of Object.entries(value)) {
    if (key === REGEX_KEY) return [key]
    const below = reservedKeyPath(child)
    if (below) return [Array.isArray(value) ? Number(key) : key, ...below]
  }
  return undefined
}

const isAnswer = (answer: McpAnswer) => typeof answer.isError === "boolean" && jsonValue.safeParse(answer.content).success
