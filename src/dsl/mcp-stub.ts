import type { McpCaseRule, McpCaseRules } from "../core/model.ts"
import type { JsonObject, JsonValue, McpAnswer, McpInputPattern, McpStubDefinition, McpToolDefinition } from "../ports/mcp-stub.ts"

/**
 * An answer the agent receives as a tool error (`isError: true`). Build it with {@link mcpError}.
 *
 * @example
 * t.otherwise(mcpError("relation does not exist"))
 */
export class McpStubError {
  /** @internal Use {@link mcpError} instead. */
  constructor(readonly text: string) {}
}

/** What a stub tool answers: a string sent as is, any other JSON value as pretty JSON text, or {@link mcpError}. */
export type McpStubResponse = JsonValue | McpStubError

/**
 * A tool error answer, usable in `.returns()`, `.returnsInOrder()` and `.otherwise()`.
 *
 * @example
 * mcpStub("pgsql").otherwise(mcpError("relation does not exist"))
 */
export function mcpError(text: string): McpStubError {
  return new McpStubError(text)
}

const answerOf = (response: McpStubResponse): McpAnswer =>
  response instanceof McpStubError ? { content: response.text, isError: true } : { content: response, isError: false }

/**
 * The answer of a rule opened by `.on(...)`. Until one of its methods is called, the rule is incomplete: a configure
 * callback that returns it does not compile.
 */
export class McpRuleAnswer<Next> {
  readonly #complete: (answers: readonly McpAnswer[]) => Next

  /** @internal Use `.on(...)` instead. */
  constructor(complete: (answers: readonly McpAnswer[]) => Next) {
    this.#complete = complete
  }

  /**
   * Answers every matching call with `response`.
   *
   * @example
   * s.on("get_object_details", { object_name: "orders" }).returns({ table: "public.orders", indexes: [] })
   */
  returns(response: McpStubResponse): Next {
    return this.#complete([answerOf(response)])
  }

  /**
   * Answers the first matching call with `first`, the next one with the next response, and every call past the end
   * with the last response.
   *
   * @example
   * s.on("get_job_status").returnsInOrder({ status: "running" }, { status: "done" })
   */
  returnsInOrder(first: McpStubResponse, ...rest: McpStubResponse[]): Next {
    return this.#complete([first, ...rest].map(answerOf))
  }
}

/**
 * Describes one tool of a stub: what the agent sees, and the answers shared by every case. Obtained from
 * `mcpStub(name).tool(name, t => t...)`. Every method returns a new builder.
 */
export class McpToolBuilder {
  readonly #state: McpToolDefinition

  /** @internal Use `mcpStub(name).tool(name, t => ...)` instead. */
  constructor(state: McpToolDefinition) {
    this.#state = state
  }

  /**
   * What the agent reads to choose the tool: copy it from the real server's `tools/list`.
   *
   * @example
   * t.description("Columns, nullability, constraints and indexes of a table.")
   */
  description(text: string): McpToolBuilder {
    return this.#with({ description: text })
  }

  /**
   * The JSON Schema of the tool input, sent as is in `tools/list` and never checked. Default `{ "type": "object" }`.
   *
   * @example
   * t.inputSchema({ type: "object", properties: { object_name: { type: "string" } }, required: ["object_name"] })
   */
  inputSchema(schema: JsonObject): McpToolBuilder {
    return this.#with({ inputSchema: schema })
  }

  /**
   * Answers any input with `response`, in every case: shorthand for `.on().returns(response)`.
   *
   * @example
   * t.returns({ instances: ["prod"] })
   */
  returns(response: McpStubResponse): McpToolBuilder {
    return this.on().returns(response)
  }

  /**
   * Opens a rule for the calls whose input matches `when`, in every case; rules are tried in declaration order,
   * after the rules of the case. Omit `when` to match any input.
   *
   * @example
   * t.on({ object_name: /^(public\.)?orders$/ }).returns({ table: "public.orders" })
   */
  on(when?: McpInputPattern): McpRuleAnswer<McpToolBuilder> {
    return new McpRuleAnswer((answers) =>
      this.#with({ rules: [...this.#state.rules, { ...(when !== undefined && { when }), answers, answeredBy: "stub" }] }),
    )
  }

  /**
   * Answers the calls no rule matches, before the server's `otherwise`. Default: a tool error, `No result for these arguments.`
   *
   * @example
   * t.otherwise(mcpError("relation does not exist"))
   */
  otherwise(response: McpStubResponse): McpToolBuilder {
    return this.#with({ otherwise: answerOf(response) })
  }

  /** @internal */
  toDefinition(): McpToolDefinition {
    return this.#state
  }

  #with(patch: Partial<McpToolDefinition>): McpToolBuilder {
    return new McpToolBuilder({ ...this.#state, ...patch })
  }
}

declare const toolNames: unique symbol

/**
 * A fake MCP server: its tools as the agent sees them, and the answers shared by every case. Start with {@link mcpStub}.
 * Present in the trials of the variants that declare it with `v.mcpStub(stub)`; a case adds its own answers with
 * `c.mcpStub(stub, s => ...)`. Every method returns a new value: a stub can be shared between suites.
 */
export class McpStub<Tools extends string = string> {
  /** Type-level only, absent at runtime: the declared tool names, which `c.mcpStub()` and `mcpCalled()` accept. */
  declare readonly [toolNames]: Tools
  readonly #state: McpStubDefinition

  /** @internal Use {@link mcpStub} instead. */
  constructor(state: McpStubDefinition) {
    this.#state = state
  }

  /**
   * Adds a tool, configured by `configure`: description, input schema, answers shared by every case.
   *
   * @example
   * mcpStub("pgsql").tool("list_instances", (t) => t.description("Lists the instances.").returns({ instances: ["prod"] }))
   */
  tool<Name extends string>(name: Name, configure: (tool: McpToolBuilder) => McpToolBuilder): McpStub<Tools | Name> {
    const tool = configure(new McpToolBuilder({ name, inputSchema: { type: "object" }, rules: [] })).toDefinition()
    return new McpStub<Tools | Name>({ ...this.#state, tools: [...this.#state.tools, tool] })
  }

  /**
   * Answers the calls neither a rule nor the tool's `otherwise` answers. Default: a tool error, `No result for these arguments.`
   *
   * @example
   * mcpStub("pgsql").otherwise(mcpError("relation does not exist"))
   */
  otherwise(response: McpStubResponse): McpStub<Tools> {
    return new McpStub<Tools>({ ...this.#state, otherwise: answerOf(response) })
  }

  /** @internal Unvalidated definition; the suite validates it. */
  toDefinition(): McpStubDefinition {
    return this.#state
  }
}

/**
 * Starts a fake MCP server named `server`, served over stdio inside the trial sandbox.
 *
 * @example
 * const pgsql = mcpStub("pgsql").tool("get_object_details", (t) => t.description("Columns and indexes of a table."))
 * suite("sql-review").variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt("Review change.diff"))
 */
export function mcpStub(server: string): McpStub<never> {
  return new McpStub<never>({ server, tools: [] })
}

/**
 * The answers one case gives for the tools of one stub, on top of the stub's own: obtained from
 * `c.mcpStub(stub, s => s.on(tool, when).returns(...))`. Every method returns a new builder.
 */
export class McpStubRules<Tools extends string> {
  readonly #rules: readonly McpCaseRule[]

  /** @internal Use `c.mcpStub(stub, s => ...)` instead. */
  constructor(rules: readonly McpCaseRule[]) {
    this.#rules = rules
  }

  /**
   * Opens a rule for the calls of `tool` whose input matches `when`; tried in declaration order, before the stub's own
   * rules. Omit `when` to match any input.
   *
   * @example
   * s.on("get_object_details", { object_name: "orders" }).returns({ table: "public.orders", indexes: ["orders_pkey (id)"] })
   */
  on(tool: Tools, when?: McpInputPattern): McpRuleAnswer<McpStubRules<Tools>> {
    return new McpRuleAnswer((answers) => new McpStubRules<Tools>([...this.#rules, { tool, ...(when !== undefined && { when }), answers }]))
  }

  /** @internal */
  toDefinition(server: string): McpCaseRules {
    return { server, rules: this.#rules }
  }
}

/** @internal */
export const emptyRules = <Tools extends string>(): McpStubRules<Tools> => new McpStubRules<Tools>([])
