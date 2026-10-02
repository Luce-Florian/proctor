import type { Workspace } from "./workspace.ts"

/** What a sandbox must let through beyond its own workspace. A sandbox without OS isolation ignores it. */
export interface SandboxAccess {
  /** Domains the process may reach, e.g. the model API. Everything else is blocked. */
  readonly allowedDomains: readonly string[]
  /** Host paths the process may read, e.g. the agent binary or a hook script. The host home is otherwise hidden. */
  readonly readablePaths: readonly string[]
  /** Host paths the process may write, and read back, beyond its workspace, e.g. a tool cache under `/tmp`. */
  readonly writablePaths?: readonly string[]
}

/** Nothing let through. */
export const NO_ACCESS: SandboxAccess = { allowedDomains: [], readablePaths: [], writablePaths: [] }

/**
 * Merges access needs, dropping duplicates.
 *
 * @example
 * mergeAccess(agent.sandboxAccess, suite.sandboxAccess) // { allowedDomains: ["api.example.com", ...], ... }
 */
export function mergeAccess(...parts: readonly (SandboxAccess | undefined)[]): SandboxAccess {
  const all = parts.filter((p) => p !== undefined)
  return {
    allowedDomains: [...new Set(all.flatMap((p) => p.allowedDomains))],
    readablePaths: [...new Set(all.flatMap((p) => p.readablePaths))],
    writablePaths: [...new Set(all.flatMap((p) => p.writablePaths ?? []))],
  }
}

/** What a trial asks from a sandbox. */
export interface SandboxSpec {
  /** Human-readable trial label, e.g. `hello [baseline] #1`, useful for temp dir names and logs. */
  readonly label: string
  /** What the agent and the suite need through the sandbox. */
  readonly access: SandboxAccess
}

/**
 * How well a sandbox shields the host, written in the report (`environment.extra.isolation`).
 * - `none`: a temp directory only; the agent can reach the host home and the network.
 * - `degraded`: HOME and config directories are temporary, without an OS sandbox.
 * - `full`: OS-level sandbox restricting reads, writes and network.
 */
export const ISOLATION_LEVELS = ["none", "degraded", "full"] as const
export type IsolationLevel = (typeof ISOLATION_LEVELS)[number]

/**
 * Creates and destroys isolated workspaces.
 *
 * Implementations live outside the core (e.g. `local-temp`, `srt`, `docker`) and are registered by id.
 */
export interface Sandbox {
  /** Stable identifier written in the report, e.g. `srt`. */
  readonly id: string
  readonly isolation: IsolationLevel
  /** Creates a fresh workspace. Must never reuse the host configuration. */
  create(spec: SandboxSpec): Promise<Workspace>
  /** Releases everything `create` allocated. Called exactly once per created workspace, even on failure. */
  destroy(workspace: Workspace): Promise<void>
}
