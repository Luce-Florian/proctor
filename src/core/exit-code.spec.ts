import { describe, expect, it } from "vitest"
import type { TrialResult } from "../ports/run.ts"
import { exitCodeFor } from "./exit-code.ts"

describe("exitCodeFor", () => {
  const trial = (status: TrialResult["status"]) => ({ status })

  it.each([
    ["everything passes", ["passed", "skipped"], 0],
    ["one trial failed", ["passed", "failed"], 1],
    ["one infra error", ["passed", "other"], 2],
    ["infra error wins over failure", ["failed", "other"], 2],
    ["nothing ran", [], 0],
  ] as const)("returns the right code when %s", (_, statuses, expected) => {
    expect(exitCodeFor({ trials: statuses.map(trial) })).toBe(expected)
  })
})
