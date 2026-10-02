import { killProcessGroups } from "../adapters/process.ts"
import { InterruptedError } from "../core/errors.ts"
import type { Output } from "../reporters/console.ts"

/** Exit code of a run stopped by a second interrupt: 128 + SIGINT, as shells report it. */
const FORCED_EXIT = 130

const SIGNALS = ["SIGINT", "SIGTERM"] as const

export interface InterruptOptions {
  /** Emits the signals. Default: `process`. */
  readonly proc?: Pick<NodeJS.EventEmitter, "on" | "off">
  readonly stderr?: Output
  /** Kills every agent process group. Default: {@link killProcessGroups}. */
  readonly killAll?: () => void
  readonly exit?: (code: number) => void
}

/**
 * Wires Ctrl-C and SIGTERM to `controller`. The first one aborts the run: running trials stop, cleanups and
 * `afterAll` run, the partial report is written. The second one kills every agent process group and exits at once.
 * Returns what removes the handlers.
 *
 * @example
 * const release = interruptOnSignals(controller)
 * process.exitCode = await main(argv, { ...io, signal: controller.signal })
 * release()
 */
export function interruptOnSignals(controller: AbortController, options: InterruptOptions = {}): () => void {
  const { proc = process, stderr = process.stderr, killAll = killProcessGroups, exit = (code: number) => process.exit(code) } = options
  const handlers = SIGNALS.map((name) => {
    const handler = () => {
      if (!controller.signal.aborted) {
        stderr.write(`\nInterrupted (${name}): stopping the running trials and cleaning up; press Ctrl-C again to exit now.\n`)
        controller.abort(new InterruptedError(name))
        return
      }
      killAll()
      exit(FORCED_EXIT)
    }
    proc.on(name, handler)
    return [name, handler] as const
  })
  return () => {
    for (const [name, handler] of handlers) proc.off(name, handler)
  }
}
