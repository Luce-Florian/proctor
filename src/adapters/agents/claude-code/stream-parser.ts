import type { AgentRunResult, TokenUsage, ToolCall } from "../../../ports/agent.ts"

/** The `system/init` event: what the session loaded (MCP servers, plugins, tools, model). */
export interface InitEvent {
  readonly type: "system"
  readonly subtype: "init"
  readonly model?: string
  readonly claude_code_version?: string
  readonly tools?: readonly string[]
  readonly mcp_servers?: readonly { readonly name: string; readonly status?: string }[]
  readonly plugins?: readonly { readonly name: string; readonly path?: string; readonly source?: string }[]
}

/** A `system/hook_started` event. Only `SessionStart` hooks show up before `system/init`, where the probe runs. */
export interface HookEvent {
  readonly type: "system"
  readonly subtype: "hook_started"
  /** e.g. `SessionStart:startup`. */
  readonly hook_name?: string
  /** e.g. `SessionStart`. */
  readonly hook_event?: string
}

/** The final `result` event. */
export interface ResultEvent {
  readonly type: "result"
  readonly subtype?: string
  readonly is_error?: boolean
  readonly result?: string
  readonly num_turns?: number
  readonly total_cost_usd?: number
  readonly duration_ms?: number
  readonly modelUsage?: Readonly<Record<string, ModelUsage>>
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
}

interface ModelUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadInputTokens?: number
  readonly cacheCreationInputTokens?: number
}

type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input?: unknown }
  | { readonly type: "tool_result"; readonly tool_use_id: string; readonly content?: unknown; readonly is_error?: boolean }
  | { readonly type: string }

interface MessageEvent {
  readonly type: "assistant" | "user"
  readonly message?: { readonly content?: readonly ContentBlock[] | string }
}

type StreamEvent = InitEvent | ResultEvent | MessageEvent | { readonly type: string; readonly subtype?: string }

/** What {@link StreamCollector.finish} needs beyond the stream itself. */
export interface FinishOptions {
  /** Wall-clock duration measured by the adapter. */
  readonly durationMs: number
  readonly transcriptPath?: string
}

/**
 * Collects a `claude -p --output-format stream-json --verbose` stream, one JSON line at a time,
 * into an agent-neutral {@link AgentRunResult}. Lines that are not JSON (a stray warning) are ignored.
 *
 * @example
 * const stream = new StreamCollector()
 * for (const line of lines) stream.add(line)
 * const result = stream.finish({ durationMs: 1200 })
 */
export class StreamCollector {
  #init: InitEvent | undefined
  #result: ResultEvent | undefined
  readonly #hooks: HookEvent[] = []
  #lastText = ""
  readonly #calls: { id: string; call: ToolCall }[] = []
  readonly #outputs = new Map<string, { output: string; isError: boolean }>()

  /** The `system/init` event, once seen. */
  get init(): InitEvent | undefined {
    return this.#init
  }

  /** The hooks seen starting so far, in order. */
  get hooks(): readonly HookEvent[] {
    return this.#hooks
  }

  /** The final `result` event, once seen. */
  get result(): ResultEvent | undefined {
    return this.#result
  }

  /**
   * Parses one line and returns the event, or `undefined` for a blank or non-JSON line.
   *
   * @example
   * stream.add('{"type":"system","subtype":"init","model":"claude-sonnet-5"}')?.type // "system"
   */
  add(line: string): StreamEvent | undefined {
    const event = parseLine(line)
    if (!event) return undefined
    if (isInit(event)) this.#init = event
    else if (event.type === "system" && event.subtype === "hook_started") this.#hooks.push(event as HookEvent)
    else if (event.type === "result") this.#result = event as ResultEvent
    else if (event.type === "assistant" || event.type === "user") this.#message(event as MessageEvent)
    return event
  }

  /**
   * Builds the result; throws when the stream has no `result` event (the process died early).
   *
   * @example
   * stream.finish({ durationMs: 1200, transcriptPath: "results/transcripts/x.jsonl" }).finalText // "ok"
   */
  finish(options: FinishOptions): AgentRunResult {
    const result = this.#result
    if (!result) throw new Error("the agent stream ended without a result event")
    const usage = tokenUsage(result)
    const model = this.#init?.model ?? Object.keys(result.modelUsage ?? {})[0]
    return {
      finalText: typeof result.result === "string" ? result.result : this.#lastText,
      durationMs: options.durationMs,
      turns: result.num_turns ?? 0,
      toolCalls: this.#calls.map(({ id, call }) => ({ ...call, ...this.#outputs.get(id) })),
      ...(usage && { usage }),
      ...(result.total_cost_usd !== undefined && { costUsd: result.total_cost_usd }),
      ...(model !== undefined && { model }),
      ...(options.transcriptPath !== undefined && { transcriptPath: options.transcriptPath }),
      raw: { init: this.#init, result },
    }
  }

  #message(event: MessageEvent) {
    const content = event.message?.content
    if (!Array.isArray(content)) return
    for (const block of content as readonly ContentBlock[]) {
      if (block.type === "text" && event.type === "assistant") this.#lastText = (block as { text: string }).text
      if (block.type === "tool_use") {
        const { id, name, input } = block as { id: string; name: string; input?: unknown }
        this.#calls.push({ id, call: { name, ...(input !== undefined && { input }) } })
      }
      if (block.type === "tool_result") {
        const { tool_use_id, content: output, is_error } = block as { tool_use_id: string; content?: unknown; is_error?: boolean }
        this.#outputs.set(tool_use_id, { output: textOf(output), isError: is_error === true })
      }
    }
  }
}

function parseLine(line: string): StreamEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === "object" && value !== null && "type" in value ? (value as StreamEvent) : undefined
  } catch {
    return undefined
  }
}

const isInit = (event: StreamEvent): event is InitEvent => event.type === "system" && event.subtype === "init"

/** A tool result is a string or a list of content blocks; only their text matters to graders. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block: { type?: string; text?: string }) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
}

/**
 * Tokens summed over `modelUsage`, which counts every model call of the session, sub-agents included;
 * `usage` only counts the main loop, so it is the fallback for streams without `modelUsage`.
 */
function tokenUsage(result: ResultEvent): TokenUsage | undefined {
  const models = Object.values(result.modelUsage ?? {})
  if (models.length > 0) {
    const sum = (key: keyof ModelUsage) => models.reduce((total, m) => total + (m[key] ?? 0), 0)
    return {
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cacheReadTokens: sum("cacheReadInputTokens"),
      cacheCreationTokens: sum("cacheCreationInputTokens"),
    }
  }
  const { usage } = result
  if (!usage) return undefined
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  }
}
