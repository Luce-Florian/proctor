import type { SandboxAccess } from "../../../ports/sandbox.ts"
import type { TempLayout } from "../temp-layout.ts"

/** The part of the `srt` settings file the harness writes (see the `@anthropic-ai/sandbox-runtime` README). */
export interface SrtSettings {
  readonly network: { readonly allowedDomains: readonly string[]; readonly deniedDomains: readonly string[] }
  readonly filesystem: {
    readonly denyRead: readonly string[]
    readonly allowRead: readonly string[]
    readonly allowWrite: readonly string[]
    readonly denyWrite: readonly string[]
  }
}

/** Host directories hidden from every trial, besides its own root. */
export interface HiddenHostPaths {
  /** The host home: `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude`... */
  readonly home: string
  /** Temp and volume directories shared by the host: other trial roots, host tool sessions, mounted disks. */
  readonly sharedTemp: readonly string[]
}

/**
 * Host directories shared between processes that a trial must not read, when they exist: the host temp dirs
 * (`/tmp/claude-<uid>` holds the outputs of the host Claude Code sessions) and mounted volumes.
 * The directory holding the trial roots is added by the sandbox.
 */
export const SHARED_TEMP_DIRS: readonly string[] = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders", "/Volumes"]

/**
 * The `srt` policy of one trial, deny-broad then allow-narrow (srt lets `allowRead` win over `denyRead`):
 * - reads: the host home and the shared temp dirs are hidden, except the trial's own temp root and the paths
 *   the agent or suite declared (its binary, a hook script, a writable path);
 * - writes: only the workspace, the sandbox home, the sandbox TMPDIR and the declared writable paths, never the
 *   settings file itself;
 * - network: only the declared domains, e.g. the model API. Paths are absolute: `~` would expand to the sandbox home.
 *
 * @example
 * srtSettings(layout, { allowedDomains: ["api.anthropic.com"], readablePaths: [] }, { home: "/Users/me", sharedTemp: ["/tmp"] })
 * // { network: { allowedDomains: ["api.anthropic.com"], ... }, filesystem: { denyRead: ["/Users/me", "/tmp"], ... } }
 */
export function srtSettings(layout: TempLayout, access: SandboxAccess, hidden: HiddenHostPaths): SrtSettings {
  const writable = access.writablePaths ?? []
  return {
    network: { allowedDomains: [...access.allowedDomains], deniedDomains: [] },
    filesystem: {
      denyRead: [...new Set([hidden.home, ...hidden.sharedTemp])],
      allowRead: [...new Set([layout.root, ...access.readablePaths, ...writable])],
      allowWrite: [...new Set([layout.cwd, layout.home, layout.tmp, ...writable])],
      denyWrite: [],
    },
  }
}
