import { dirname } from "node:path"
import type { Sandbox, SandboxSpec } from "../../../ports/sandbox.ts"
import type { Workspace } from "../../../ports/workspace.ts"
import { allocateLayout, layoutEnv, releaseLayout, type LayoutOptions } from "../temp-layout.ts"

export type LocalTempOptions = LayoutOptions

/**
 * Config-level isolation, no OS sandbox: a fresh HOME, TMPDIR and XDG directories per trial, and an environment
 * built from an allow-list instead of inherited. The agent can still read the host disk and reach the network:
 * isolation `degraded`. Use it only when `srt` is unavailable.
 *
 * @example
 * const sandbox = new LocalTempSandbox()
 * const ws = await sandbox.create({ label: "review [baseline] #1", access: NO_ACCESS }) // ws.home is a temp dir
 */
export class LocalTempSandbox implements Sandbox {
  readonly id = "local-temp"
  readonly isolation = "degraded"
  readonly #options: LocalTempOptions

  constructor(options: LocalTempOptions = {}) {
    this.#options = options
  }

  /** @example const ws = await sandbox.create(spec) */
  async create(spec: SandboxSpec): Promise<Workspace> {
    const layout = await allocateLayout(spec.label, this.#options)
    return { cwd: layout.cwd, home: layout.home, env: layoutEnv(layout, this.#options) }
  }

  /** @example await sandbox.destroy(ws) // removes the whole temp root */
  destroy(workspace: Workspace): Promise<void> {
    return releaseLayout(dirname(workspace.cwd))
  }
}
