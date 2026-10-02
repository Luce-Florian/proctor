import { setTimeout as sleep } from "node:timers/promises"
import { ABORT_GRACE_MS } from "../ports/agent.ts"
import { formatDuration } from "./duration.ts"

/** Raised when the agent run exceeds the case timeout. */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError"

  constructor(
    readonly timeoutMs: number,
    graceMs?: number,
    options?: ErrorOptions,
  ) {
    const stuck = graceMs === undefined ? "" : `; the agent did not stop within ${formatDuration(graceMs)} of the abort`
    super(`timed out after ${formatDuration(timeoutMs)}: raise the case .timeout(...) if the agent needs longer${stuck}`, options)
  }
}

export interface TimeoutOptions {
  /** How long to wait, once aborted, for `task` to settle. Default {@link ABORT_GRACE_MS}. */
  readonly graceMs?: number
  /** Interrupts the task from outside (Ctrl-C): aborted with the same reason, which is then thrown. */
  readonly signal?: AbortSignal
}

/**
 * Runs `task` and rejects with a {@link TimeoutError} after `timeoutMs`, aborting the signal handed to it.
 * Once aborted, by the deadline or by `options.signal`, it waits up to `graceMs` for `task` to settle,
 * so that cleanups never race a running agent, then rejects anyway. What the task rejected with is kept as `cause`.
 *
 * @example
 * await withTimeout((signal) => agent.run({ ...input, signal }, ws), 600_000, { signal: interrupt })
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  options: TimeoutOptions = {},
): Promise<T> {
  const { graceMs = ABORT_GRACE_MS, signal } = options
  const controller = new AbortController()
  const running = Promise.resolve().then(() => task(controller.signal))
  const settled = running.then(
    (): { error: unknown } => ({ error: undefined }),
    (error: unknown) => ({ error }),
  )
  const deadline = new AbortController()
  const interrupted = new Promise<"interrupted">((resolve) => {
    if (signal?.aborted) {
      resolve("interrupted")
      return
    }
    signal?.addEventListener("abort", () => resolve("interrupted"), { once: true, signal: deadline.signal })
  })
  try {
    const first = await Promise.race([settled, interrupted, sleep(timeoutMs, "timeout" as const, { signal: deadline.signal })])
    if (typeof first === "object") return await running
    const reason: unknown = first === "timeout" ? new TimeoutError(timeoutMs) : signal?.reason
    controller.abort(reason)
    const graced = await Promise.race([settled, sleep(graceMs, "stuck" as const, { signal: deadline.signal })])
    const failure = typeof graced === "object" ? graced.error : undefined
    const cause = failure instanceof Error ? { cause: failure } : undefined
    if (first === "timeout") throw new TimeoutError(timeoutMs, graced === "stuck" ? graceMs : undefined, cause)
    throw reason instanceof Error ? reason : new Error("interrupted", cause)
  } finally {
    deadline.abort()
  }
}
