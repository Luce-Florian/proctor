import { AgentRunError } from "../ports/agent.ts"
import { GradeError, type JudgeUsage } from "../ports/grader.ts"

/**
 * Normalizes anything thrown into an `Error`.
 *
 * @example
 * catch (error) { errors.push(asError(error)) }
 */
export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Runs a step and prefixes its error with the step name, so the report says where it broke.
 * The original error is kept as `cause`, and its stack as the stack.
 *
 * @example
 * await step("sandbox create", () => sandbox.create(spec)) // throws "sandbox create failed: ..."
 */
export async function step<T>(label: string, task: () => T | Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    const cause = asError(error)
    throw Object.assign(new Error(`${label} failed: ${cause.message}`, { cause }), { stack: cause.stack })
  }
}

/**
 * Abort reason of a run interrupted from outside (Ctrl-C, SIGTERM): the running trials stop, cleanups run,
 * the others are not started. Every one of them is `other`.
 *
 * @example
 * controller.abort(new InterruptedError("SIGINT"))
 */
export class InterruptedError extends Error {
  override readonly name = "InterruptedError"

  constructor(signalName: string) {
    super(`interrupted by ${signalName}: cleanups ran, the remaining trials were not started`)
  }
}

/** The first error along the `cause` chain that is an instance of `type`. */
function findCause<T extends Error>(error: unknown, type: abstract new (...args: never[]) => T): T | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof type) return e
  }
  return undefined
}

/**
 * The transcript an agent kept before failing, found along the `cause` chain of the error.
 *
 * @example
 * transcriptPathOf(new Error("agent run failed", { cause: new AgentRunError(e, "t.jsonl") })) // "t.jsonl"
 */
export const transcriptPathOf = (error: unknown): string | undefined => findCause(error, AgentRunError)?.transcriptPath

/**
 * The trace a grader attached to its error (e.g. the judge's raw answers), found along the `cause` chain.
 *
 * @example
 * traceOf(new Error("grader judge failed", { cause: new GradeError("invalid JSON", "raw answer") })) // "raw answer"
 */
export const traceOf = (error: unknown): string | undefined => findCause(error, GradeError)?.trace

/**
 * What the judge calls of a failed grader cost, found along the `cause` chain.
 *
 * @example
 * judgeUsageOf(new Error("grader judge failed", { cause: new GradeError("timeout", "", { calls: 2 }) })) // { calls: 2 }
 */
export const judgeUsageOf = (error: unknown): JudgeUsage | undefined => findCause(error, GradeError)?.judgeUsage
