import { describe, expect, it } from "vitest"
import { InterruptedError } from "./errors.ts"
import { TimeoutError, withTimeout } from "./timeout.ts"

describe("withTimeout", () => {
  it("returns the task result before the deadline", async () => {
    expect(await withTimeout(async () => 42, 1_000)).toBe(42)
  })

  it("rejects with a TimeoutError even when the aborted task rejects on its own", async () => {
    const task = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))

    await expect(withTimeout(task, 20)).rejects.toThrow(TimeoutError)
  })

  it("gives up after the grace period when the task never settles", async () => {
    const started = Date.now()

    await expect(withTimeout(() => new Promise(() => {}), 20, { graceMs: 30 })).rejects.toThrow(/did not stop within 30ms/)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it("keeps what the aborted task rejected with as the cause, e.g. an error carrying a transcript", async () => {
    const failure = new Error("killed")
    const task = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(failure)))

    const error: unknown = await withTimeout(task, 20).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TimeoutError)
    expect((error as Error).cause).toBe(failure)
  })

  it("aborts the task when the run is interrupted, and rejects with the interruption", async () => {
    const interrupt = new AbortController()
    let seen: unknown
    const task = (signal: AbortSignal) =>
      // The task rejects with the abort reason as is: that is what withTimeout must hand back.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject((seen = signal.reason))))
    setTimeout(() => interrupt.abort(new InterruptedError("SIGINT")), 10)

    await expect(withTimeout(task, 60_000, { signal: interrupt.signal })).rejects.toThrow("interrupted by SIGINT")
    expect(seen).toBeInstanceOf(InterruptedError)
  })
})
