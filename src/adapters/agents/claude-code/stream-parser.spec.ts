import { describe, expect, it } from "vitest"
import { StreamCollector } from "./stream-parser.ts"
import { collect } from "#test/adapters.ts"

describe("stream parser", () => {
  it("turns a recorded run into an AgentRunResult: text, turns, cost, tokens, resolved model", async () => {
    const result = (await collect("say-ok")).finish({ durationMs: 1234 })

    expect(result).toMatchObject({
      finalText: "ok",
      durationMs: 1234,
      turns: 1,
      costUsd: 0.0247298,
      model: "claude-sonnet-5",
      toolCalls: [],
      usage: { inputTokens: 2, outputTokens: 4, cacheReadTokens: 19109, cacheCreationTokens: 5216 },
    })
  })

  it("pairs tool calls with their results, errors included", async () => {
    const result = (await collect("tool-calls")).finish({ durationMs: 1 })

    expect(result.turns).toBe(3)
    expect(result.toolCalls).toEqual([
      {
        name: "Bash",
        input: { command: "echo hello-from-bash", description: "Echo test string" },
        output: "hello-from-bash",
        isError: false,
      },
      { name: "Read", input: { file_path: "./note.txt" }, output: expect.stringMatching(/^File does not exist/), isError: true },
    ])
  })

  it("ignores lines that are not JSON and throws when the result never came", () => {
    const collector = new StreamCollector()
    expect(collector.add("warning: something")).toBeUndefined()
    expect(() => collector.finish({ durationMs: 0 })).toThrow("the agent stream ended without a result event")
  })
})
