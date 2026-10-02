/** A process to launch: an executable and its arguments, never a shell string. */
export interface Command {
  readonly file: string
  readonly args: readonly string[]
}

/**
 * An isolated place where a single trial runs.
 *
 * A {@link Sandbox} creates it; fixtures populate `cwd`; the agent runs inside it.
 */
export interface Workspace {
  /** Absolute path of the working directory the agent starts in. */
  readonly cwd: string
  /** Absolute path used as `HOME` for the agent process: never the developer's real home. */
  readonly home: string
  /** Environment variables handed to the agent process (allow-list, not inherited). */
  readonly env: Readonly<Record<string, string>>
  /**
   * Rewrites a command so that it runs inside the sandbox, e.g. behind an OS-level sandbox launcher.
   * Absent when the sandbox isolates nothing at the process level: run the command as is.
   */
  readonly wrap?: (command: Command) => Command
}
