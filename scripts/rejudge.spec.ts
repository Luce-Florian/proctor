import { describe, expect, it } from "vitest"
import { archivedJudge } from "./rejudge.ts"

describe("rejudge", () => {
  it("compares with the archived judge verdict alone, not the criteria of the other graders", () => {
    const test = {
      name: "c [v] #1",
      status: "failed" as const,
      duration: 1,
      extra: {
        score: 0.75,
        criteria: [
          { id: "c01", met: true, grader: "judge" },
          { id: "c02", met: false, grader: "judge" },
          { id: "max-cost-usd", met: false, grader: "limits" },
          { id: "says-hello", met: true, grader: "hello" },
        ],
      },
    }

    expect(archivedJudge(test)).toEqual({ met: 1, total: 2, score: 4, missed: ["c02"] })
    const phase2 = { ...test, extra: { ...test.extra, criteria: [{ id: "c01", met: true, grader: "llm-judge" }] } }
    expect(archivedJudge(phase2)).toMatchObject({ met: 1, total: 1 })
  })
})
