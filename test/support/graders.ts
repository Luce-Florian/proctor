import type { AgentRunInput, Grader, JudgeRuntime, toolCallsFail, ToolCall } from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { gradeContext } from "./helpers.ts"

/** The criteria a grader returns for a run that answered `result`, as `[id, met, why]`, in a workspace at `cwd`. */
export const criteriaOf = async (grader: Grader, result: Parameters<typeof gradeContext>[0], cwd = "/") =>
  (await grader.grade(gradeContext(result, { workspace: { cwd, home: cwd, env: {} } }))).criteria.map((c) => [c.id, c.met, c.why])

/** The first criterion a grader returns for a run that made `toolCalls`. */
export const grade = async (grader: ReturnType<typeof toolCallsFail>, toolCalls: ToolCall[], extra = {}) =>
  (await grader.grade(gradeContext({ toolCalls, ...extra }))).criteria[0]

/** A judge answer: the score and, per criterion id, whether it is met. */
export const verdict = (score: number, met: Record<string, boolean>) =>
  JSON.stringify({ score, criteria: Object.entries(met).map(([id, m]) => ({ id, met: m, why: `${id} ${m ? "ok" : "absent"}` })) })

/** A judge agent answering `answers` in turn (the last one repeats), with a cost per run. */
export function fakeJudge(...answers: string[]): JudgeRuntime & { calls: AgentRunInput[]; sandbox: FakeSandbox } {
  const calls: AgentRunInput[] = []
  const agent = new FakeAgentAdapter({
    id: "judge",
    reply: (input) => {
      calls.push(input)
      return answers[Math.min(calls.length, answers.length) - 1] ?? ""
    },
  })
  const run = agent.run.bind(agent)
  agent.run = async (input, ws) => ({ ...(await run(input, ws)), costUsd: 0.01, usage: { inputTokens: 100, outputTokens: 10 } })
  return { agent, sandbox: new FakeSandbox(), calls }
}
