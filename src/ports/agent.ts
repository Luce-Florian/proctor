import type { Teardown } from "./fixture.ts"
import type { SandboxAccess } from "./sandbox.ts"
import type { Workspace } from "./workspace.ts"

/** Permission levels granted to the agent, from the most to the least restrictive. */
export const PERMISSIONS = ["readonly", "workspace-write", "full"] as const
export type Permissions = (typeof PERMISSIONS)[number]

/** How long the harness waits, once `signal` aborts, for `run()` to settle before cleaning the workspace up. */
export const ABORT_GRACE_MS = 5_000

/** Agent-neutral description of one run. Adapters translate it into their own flags. */
export interface AgentRunInput {
  readonly prompt: string
  /** Plugin identifiers the adapter must make available, and nothing else. */
  readonly plugins: readonly string[]
  /** MCP server definitions, keyed by server name. Opaque to the core. */
  readonly mcpServers: Readonly<Record<string, unknown>>
  /** Exact model identifier; `undefined` lets the adapter pick its default. */
  readonly model?: string
  readonly permissions: Permissions
  /** Adapter-specific settings. Opaque to the core. */
  readonly settings: Readonly<Record<string, unknown>>
  /** Aborted when the trial times out or the run is interrupted: stop the agent process and settle, see {@link AgentAdapter.run}. */
  readonly signal: AbortSignal
}

/** Agent-neutral description of what a trial asks before `run()`: the plugins to make available. */
export type AgentPrepareInput = Omit<AgentRunInput, "prompt">

/** Token usage reported by the agent. */
export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  /** Input tokens served from the prompt cache, when the agent reports them. */
  readonly cacheReadTokens?: number
  /** Input tokens written to the prompt cache, when the agent reports them. */
  readonly cacheCreationTokens?: number
}

/**
 * Sums token counts; a cache counter is kept only when some run reported it.
 *
 * @example
 * sumTokens([{ inputTokens: 1, outputTokens: 2 }, { inputTokens: 3, outputTokens: 4 }]) // { inputTokens: 4, outputTokens: 6 }
 */
export function sumTokens(usages: readonly TokenUsage[]): TokenUsage {
  const sum = (pick: (u: TokenUsage) => number | undefined) => usages.reduce((total, u) => total + (pick(u) ?? 0), 0)
  const some = (pick: (u: TokenUsage) => number | undefined) => usages.some((u) => pick(u) !== undefined)
  return {
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    ...(some((u) => u.cacheReadTokens) && { cacheReadTokens: sum((u) => u.cacheReadTokens) }),
    ...(some((u) => u.cacheCreationTokens) && { cacheCreationTokens: sum((u) => u.cacheCreationTokens) }),
  }
}

/** One tool invocation observed during the run. */
export interface ToolCall {
  readonly name: string
  readonly input?: unknown
  /** What the tool returned, as text, when the agent reports it. */
  readonly output?: string
  /** True when the tool reported a failure (non-zero exit, denied read...). */
  readonly isError?: boolean
}

/** Normalized outcome of a run, whatever the agent. */
export interface AgentRunResult {
  /** Last message produced by the agent. */
  readonly finalText: string
  /** Wall-clock duration of the run, in milliseconds. */
  readonly durationMs: number
  readonly turns: number
  readonly toolCalls: readonly ToolCall[]
  readonly usage?: TokenUsage
  /** Cost of the run in US dollars, when the agent reports it. */
  readonly costUsd?: number
  /** Exact model that answered, as the agent resolved it (an alias resolves to an id). */
  readonly model?: string
  /** Fingerprint of the plugin files the agent loaded, so a report says which version it measured. */
  readonly pluginSha?: string
  /** Path of the raw transcript, when the adapter keeps one. */
  readonly transcriptPath?: string
  /** Adapter-specific payload, never read by the core. */
  readonly raw?: unknown
}

/**
 * Thrown by {@link AgentAdapter.run} when the agent started but the run failed (isolation leak, crash, abort):
 * keeps the transcript it recorded, so the trial report can point at it. The message is the cause's.
 *
 * @example
 * throw new AgentRunError(error, "results/transcripts/2026-09-30T17-30-41-000Z-a1b2c3.jsonl")
 */
export class AgentRunError extends Error {
  override readonly name = "AgentRunError"

  constructor(
    cause: Error,
    readonly transcriptPath: string,
  ) {
    super(cause.message, { cause })
  }
}

/**
 * Drives one coding agent. The only place that knows a given agent.
 */
export interface AgentAdapter {
  /** Stable identifier written in the report and used by `--agent`. */
  readonly id: string
  /** Version of the underlying agent, written in the report. */
  version(): Promise<string>
  /** Facts written next to the agent in the report, e.g. how it authenticates. */
  readonly details?: Readonly<Record<string, string>>
  /** What the agent needs through the sandbox (its model API, its own binary), merged with the suite's needs. */
  readonly sandboxAccess?: SandboxAccess
  /**
   * Makes the variant's plugins available inside the workspace, e.g. installs them in its home.
   * Runs after fixtures and before `beforeEach`, outside the agent's own sandbox; returns its undo when needed.
   */
  // `void`, not `undefined`: an implementation declared `Promise<void>` must satisfy the port.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  prepare?(input: AgentPrepareInput, workspace: Workspace): Promise<Teardown | void>
  /**
   * Runs the agent in `workspace`. Must settle promptly once `input.signal` aborts, e.g. by killing the process:
   * cleanups wait at most {@link ABORT_GRACE_MS} for it, then run anyway while the agent may still write.
   */
  run(input: AgentRunInput, workspace: Workspace): Promise<AgentRunResult>
}
