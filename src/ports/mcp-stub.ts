/** A JSON value, as an MCP tool answers it or a suite writes it. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** A JSON object, e.g. the input schema of a tool. */
export type JsonObject = Readonly<Record<string, JsonValue>>

/**
 * A value an input field must match: a `RegExp` matches a string it finds (`search`), an array matches element by
 * element with the same length, an object matches when each of its keys is in the input and matches (extra input keys
 * are ignored), any other value matches when equal.
 */
export type JsonPattern = string | number | boolean | null | RegExp | readonly JsonPattern[] | { readonly [key: string]: JsonPattern }

/** Which tool inputs a rule answers: an object pattern, or a `RegExp` over the JSON of the whole input. */
export type McpInputPattern = RegExp | Readonly<Record<string, JsonPattern>>

/** One answer of a stub tool: the content the agent receives, and whether it is a tool error (`isError`). */
export interface McpAnswer {
  /** A string is sent as is; any other value as pretty JSON text. */
  readonly content: JsonValue
  readonly isError: boolean
}

/** Answers the calls of one tool whose input matches `when`. */
export interface McpStubRule {
  /** Absent: any input. */
  readonly when?: McpInputPattern
  /** Given in order to the matching calls; the last one answers every later call. Never empty. */
  readonly answers: readonly McpAnswer[]
}

/** What answered a call to a stub: a rule of the case, a rule shared by every case, or a fallback (`otherwise`, built-in). */
export const MCP_ANSWERED_BY = ["case", "stub", "fallback"] as const
export type McpAnsweredBy = (typeof MCP_ANSWERED_BY)[number]

/** A rule of a stub tool, tagged with where it comes from: the case being run, or the stub itself, shared by every case. */
export interface McpToolRule extends McpStubRule {
  readonly answeredBy: Exclude<McpAnsweredBy, "fallback">
}

/** One tool of a stub server: what the agent sees in `tools/list`, and how the stub answers its calls. */
export interface McpToolDefinition {
  readonly name: string
  readonly description?: string
  /** Sent as is in `tools/list`; never checked against the inputs. */
  readonly inputSchema: JsonObject
  /** Tried in order, the first matching one answers: the rules of the case being run, once merged in, then the stub's own. */
  readonly rules: readonly McpToolRule[]
  /** Answer when no rule matches, before the server's `otherwise`. */
  readonly otherwise?: McpAnswer
}

/**
 * A fake MCP server for one trial: plain data, so that it crosses to the stub process, which serves it over stdio.
 * Agent-neutral: each agent adapter declares it to its agent its own way.
 */
export interface McpStubDefinition {
  /** Server name, `[A-Za-z0-9_-]`. */
  readonly server: string
  readonly tools: readonly McpToolDefinition[]
  /** Answer when neither a rule nor the tool's `otherwise` applies, before the built-in fallback. */
  readonly otherwise?: McpAnswer
}
