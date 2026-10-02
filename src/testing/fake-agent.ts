import { setTimeout as sleep } from "node:timers/promises"
import type { AgentAdapter, AgentRunInput, AgentRunResult, ToolCall } from "../ports/agent.ts"
import type { Workspace } from "../ports/workspace.ts"

/** What a fake run answers: its final text, optionally with the tool calls and the transcript it reports. */
export type FakeReply = string | { readonly finalText: string; readonly toolCalls?: readonly ToolCall[]; readonly transcriptPath?: string }

export interface FakeAgentOptions {
  /** Identifier reported by the adapter. Default `fake`. */
  readonly id?: string
  /** Reported agent version. Default `0.0.0`. */
  readonly version?: string
  /**
   * Builds the final text, or the final text with the tool calls to report; may throw to simulate a crash.
   * Default: echoes the prompt.
   */
  readonly reply?: (input: AgentRunInput, workspace: Workspace) => FakeReply | Promise<FakeReply>
  /** Simulated run duration in milliseconds, fixed or computed per call. Default 0. Honours the abort signal. */
  readonly delayMs?: number | (() => number)
}

/**
 * Deterministic agent for tests and `--agent fake`: no process, no network, no LLM.
 *
 * @example
 * const agent = new FakeAgentAdapter({ reply: (input) => `hello from ${input.prompt}` })
 * await runSuite(definition, { agent, sandbox: new FakeSandbox() })
 * agent.calls // inputs received, in call order
 */
export class FakeAgentAdapter implements AgentAdapter {
  readonly id: string
  /** Inputs received, in call order. */
  readonly calls: AgentRunInput[] = []
  /** Highest number of runs observed in flight at the same time. */
  maxConcurrency = 0
  readonly #options: FakeAgentOptions
  #inFlight = 0

  constructor(options: FakeAgentOptions = {}) {
    this.#options = options
    this.id = options.id ?? "fake"
  }

  /** @example await new FakeAgentAdapter({ version: "1.2.3" }).version() // "1.2.3" */
  async version(): Promise<string> {
    return this.#options.version ?? "0.0.0"
  }

  /** @example await agent.run(input, workspace) // { finalText: "echo: <prompt>", turns: 1, ... } */
  async run(input: AgentRunInput, workspace: Workspace): Promise<AgentRunResult> {
    this.calls.push(input)
    this.#inFlight += 1
    this.maxConcurrency = Math.max(this.maxConcurrency, this.#inFlight)
    const started = Date.now()
    try {
      const { delayMs = 0, reply = (i: AgentRunInput) => `echo: ${i.prompt}` } = this.#options
      await sleep(typeof delayMs === "function" ? delayMs() : delayMs, undefined, { signal: input.signal })
      const answer = await reply(input, workspace)
      const { finalText, toolCalls = [], transcriptPath } = typeof answer === "string" ? { finalText: answer } : answer
      return {
        finalText,
        durationMs: Date.now() - started,
        turns: 1,
        toolCalls,
        costUsd: 0,
        ...(transcriptPath !== undefined && { transcriptPath }),
      }
    } finally {
      this.#inFlight -= 1
    }
  }
}
