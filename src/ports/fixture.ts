import type { Workspace } from "./workspace.ts"

/** Undoes what a fixture set up. */
export type Teardown = () => Promise<void>

/**
 * Prepares the workspace before the agent runs (copy a directory, clone a repo, apply a diff...).
 *
 * Fixtures are set up in declaration order and torn down in reverse order (LIFO).
 */
export interface Fixture {
  /** Short description used in error messages, e.g. `directory(examples/hello)`. */
  readonly description: string
  /** Returns its teardown when there is something to undo. */
  // `void`, not `undefined`: an implementation declared `Promise<void>` must satisfy the port.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  setup(workspace: Workspace): Promise<Teardown | void>
}
