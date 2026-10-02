import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { InterruptedError } from "../core/errors.ts"
import { interruptOnSignals } from "./interrupt.ts"

describe("interrupt handling", () => {
  it("aborts the run on the first Ctrl-C, kills the agents and exits on the second", () => {
    const proc = new EventEmitter()
    const controller = new AbortController()
    const said: string[] = []
    const calls: string[] = []
    const release = interruptOnSignals(controller, {
      proc,
      stderr: { write: (s: string) => said.push(s) },
      killAll: () => calls.push("kill"),
      exit: (code) => void calls.push(`exit ${code}`),
    })

    proc.emit("SIGINT")
    expect(controller.signal.reason).toBeInstanceOf(InterruptedError)
    expect(said.join("")).toContain("Interrupted (SIGINT): stopping the running trials and cleaning up; press Ctrl-C again to exit now.")
    expect(calls).toEqual([])

    proc.emit("SIGTERM")
    expect(calls).toEqual(["kill", "exit 130"])

    release()
    expect(proc.listenerCount("SIGINT") + proc.listenerCount("SIGTERM")).toBe(0)
  })
})
